//! Fast region capture for screen recording.
//!
//! The generic `xcap` path grabs an entire monitor and crops it, which costs ~30 ms per
//! frame on a 1440p display and caps recording at roughly 19 fps. Recording only ever
//! needs the selected rectangle, so on Windows we blit just that rectangle into a
//! persistent BGRA DIB section: no monitor-sized copy, no allocation per frame, and no
//! colour conversion because a 32-bit `BI_RGB` DIB is already BGRA.

/// Captures a fixed desktop rectangle into caller-owned BGRA buffers.
pub struct RegionCapturer {
    #[cfg(windows)]
    inner: windows_impl::GdiRegionCapturer,
    #[cfg(not(windows))]
    inner: fallback::XcapRegionCapturer,
    width: u32,
    height: u32,
}

impl RegionCapturer {
    pub fn new(x: i32, y: i32, width: u32, height: u32) -> Result<Self, String> {
        if width < 2 || height < 2 {
            return Err("recording region too small".into());
        }

        #[cfg(windows)]
        let inner = windows_impl::GdiRegionCapturer::new(x, y, width, height)?;
        #[cfg(not(windows))]
        let inner = fallback::XcapRegionCapturer::new(x, y, width, height);

        Ok(Self {
            inner,
            width,
            height,
        })
    }

    pub fn frame_bytes(&self) -> usize {
        (self.width as usize) * (self.height as usize) * 4
    }

    /// Fills `dest` with one freshly captured BGRA frame.
    pub fn capture_into(&mut self, dest: &mut Vec<u8>) -> Result<(), String> {
        let needed = self.frame_bytes();
        if dest.len() != needed {
            dest.resize(needed, 0);
        }
        self.inner.capture_into(dest)
    }

    /// Captures one frame as an `RgbaImage`, for the GIF encoder.
    pub fn capture_rgba(&mut self, scratch: &mut Vec<u8>) -> Result<image::RgbaImage, String> {
        self.capture_into(scratch)?;
        let mut rgba = vec![0u8; scratch.len()];
        for (src, dst) in scratch.chunks_exact(4).zip(rgba.chunks_exact_mut(4)) {
            dst[0] = src[2];
            dst[1] = src[1];
            dst[2] = src[0];
            dst[3] = 255;
        }
        image::RgbaImage::from_raw(self.width, self.height, rgba)
            .ok_or_else(|| "captured frame had an unexpected size".to_string())
    }
}

#[cfg(windows)]
mod windows_impl {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HBITMAP,
        HDC, HGDIOBJ, SRCCOPY,
    };

    pub struct GdiRegionCapturer {
        screen_dc: HDC,
        mem_dc: HDC,
        bitmap: HBITMAP,
        previous: HGDIOBJ,
        bits: *mut u8,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    }

    impl GdiRegionCapturer {
        pub fn new(x: i32, y: i32, width: u32, height: u32) -> Result<Self, String> {
            unsafe {
                let screen_dc = GetDC(None);
                if screen_dc.is_invalid() {
                    return Err("could not open a desktop device context".into());
                }

                let mem_dc = CreateCompatibleDC(Some(screen_dc));
                if mem_dc.is_invalid() {
                    ReleaseDC(None, screen_dc);
                    return Err("could not create a capture device context".into());
                }

                let mut info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: width as i32,
                        // negative height requests a top-down DIB so rows arrive in image order
                        biHeight: -(height as i32),
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };

                let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
                let bitmap =
                    CreateDIBSection(Some(screen_dc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
                        .map_err(|e| format!("could not allocate a capture bitmap: {e}"))?;

                if bits.is_null() {
                    let _ = DeleteObject(bitmap.into());
                    let _ = DeleteDC(mem_dc);
                    ReleaseDC(None, screen_dc);
                    return Err("capture bitmap had no backing memory".into());
                }

                let previous = SelectObject(mem_dc, bitmap.into());
                let _ = &mut info;

                Ok(Self {
                    screen_dc,
                    mem_dc,
                    bitmap,
                    previous,
                    bits: bits.cast::<u8>(),
                    x,
                    y,
                    width,
                    height,
                })
            }
        }

        pub fn capture_into(&mut self, dest: &mut Vec<u8>) -> Result<(), String> {
            unsafe {
                BitBlt(
                    self.mem_dc,
                    0,
                    0,
                    self.width as i32,
                    self.height as i32,
                    Some(self.screen_dc),
                    self.x,
                    self.y,
                    // CAPTUREBLT picks up layered windows such as tooltips and menus, and
                    // measured free against plain SRCCOPY for a region-sized blit
                    SRCCOPY | CAPTUREBLT,
                )
                .map_err(|e| format!("screen blit failed: {e}"))?;

                let len = (self.width as usize) * (self.height as usize) * 4;
                std::ptr::copy_nonoverlapping(self.bits, dest.as_mut_ptr(), len);
            }
            Ok(())
        }
    }

    impl Drop for GdiRegionCapturer {
        fn drop(&mut self) {
            unsafe {
                SelectObject(self.mem_dc, self.previous);
                let _ = DeleteObject(self.bitmap.into());
                let _ = DeleteDC(self.mem_dc);
                ReleaseDC(None, self.screen_dc);
            }
        }
    }
}

#[cfg(not(windows))]
mod fallback {
    pub struct XcapRegionCapturer {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    }

    impl XcapRegionCapturer {
        pub fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
            Self {
                x,
                y,
                width,
                height,
            }
        }

        pub fn capture_into(&mut self, dest: &mut Vec<u8>) -> Result<(), String> {
            let frame = crate::snip::capture_region_rgba(self.x, self.y, self.width, self.height)?;
            for (src, dst) in frame.as_raw().chunks_exact(4).zip(dest.chunks_exact_mut(4)) {
                dst[0] = src[2];
                dst[1] = src[1];
                dst[2] = src[0];
                dst[3] = src[3];
            }
            Ok(())
        }
    }
}
