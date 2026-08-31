use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

pub struct SystemAudioCapture {
    join: JoinHandle<Result<PathBuf, String>>,
}

impl SystemAudioCapture {
    pub fn start(
        path: PathBuf,
        stop: Arc<AtomicBool>,
        paused: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        #[cfg(windows)]
        {
            let (startup_tx, startup_rx) = std::sync::mpsc::sync_channel(1);
            let capture_path = path.clone();
            let join = thread::Builder::new()
                .name("system-audio-capture".into())
                .spawn(move || capture_windows_audio(&capture_path, stop, paused, startup_tx))
                .map_err(|e| e.to_string())?;

            if let Err(error) = startup_rx.recv().map_err(|e| e.to_string())? {
                let _ = join.join();
                return Err(error);
            }
            Ok(Self { join })
        }

        #[cfg(not(windows))]
        {
            let _ = (path, stop, paused);
            Err("desktop audio capture is currently available on Windows only".into())
        }
    }

    pub fn finish(self) -> Result<PathBuf, String> {
        self.join
            .join()
            .map_err(|_| "system audio thread panicked".to_string())?
    }
}

#[cfg(windows)]
fn capture_windows_audio(
    path: &Path,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    startup: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> Result<PathBuf, String> {
    use std::collections::VecDeque;
    use std::fs::File;
    use std::io::Write;
    use std::time::Duration;
    use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

    let start_result = (|| -> Result<_, String> {
        initialize_mta().ok().map_err(|e| e.to_string())?;
        let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
        let device = enumerator
            .get_default_device(&Direction::Render)
            .map_err(|e| e.to_string())?;
        let mut audio_client = device.get_iaudioclient().map_err(|e| e.to_string())?;
        let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
        let (_, min_period) = audio_client
            .get_device_period()
            .map_err(|e| e.to_string())?;
        let mode = StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: min_period,
        };
        audio_client
            .initialize_client(&format, &Direction::Capture, &mode)
            .map_err(|e| e.to_string())?;
        let capture_client = audio_client
            .get_audiocaptureclient()
            .map_err(|e| e.to_string())?;
        let output = File::create(path).map_err(|e| e.to_string())?;
        audio_client.start_stream().map_err(|e| e.to_string())?;
        Ok((audio_client, capture_client, output))
    })();

    let (audio_client, capture_client, mut output) = match start_result {
        Ok(parts) => {
            let _ = startup.send(Ok(()));
            parts
        }
        Err(error) => {
            let _ = startup.send(Err(error.clone()));
            return Err(error);
        }
    };

    let mut samples = VecDeque::new();
    while !stop.load(Ordering::SeqCst) {
        while capture_client
            .get_next_packet_size()
            .map_err(|e| e.to_string())?
            .unwrap_or(0)
            > 0
        {
            capture_client
                .read_from_device_to_deque(&mut samples)
                .map_err(|e| e.to_string())?;
        }

        if paused.load(Ordering::SeqCst) {
            samples.clear();
        } else if !samples.is_empty() {
            output
                .write_all(samples.make_contiguous())
                .map_err(|e| e.to_string())?;
            samples.clear();
        }
        thread::sleep(Duration::from_millis(5));
    }

    audio_client.stop_stream().map_err(|e| e.to_string())?;
    output.flush().map_err(|e| e.to_string())?;
    Ok(path.to_path_buf())
}
