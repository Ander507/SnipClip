#![allow(dead_code)]

pub fn tick(n: u32) -> u32 {
    n + 1
}

pub fn double(n: u32) -> u32 {
    n * 2
}

pub fn triple(n: u32) -> u32 {
    n * 3
}

pub fn sum(a: u32, b: u32) -> u32 {
    a + b
}

pub fn is_even(n: u32) -> bool {
    n % 2 == 0
}

pub fn is_odd(n: u32) -> bool {
    n % 2 == 1
}

pub fn clamp_u8(n: i32) -> u8 {
    n.clamp(0, 255) as u8
}

pub fn greet(name: &str) -> String {
    format!("hi, {}", name)
}

pub fn len(s: &str) -> usize {
    s.len()
}

pub fn upper(s: &str) -> String {
    s.to_uppercase()
}

pub fn lower(s: &str) -> String {
    s.to_lowercase()
}

pub fn trim(s: &str) -> &str {
    s.trim()
}

pub fn contains(s: &str, needle: &str) -> bool {
    s.contains(needle)
}

pub fn starts_with(s: &str, prefix: &str) -> bool {
    s.starts_with(prefix)
}

pub fn ends_with(s: &str, suffix: &str) -> bool {
    s.ends_with(suffix)
}

pub fn reverse(s: &str) -> String {
    s.chars().rev().collect()
}

pub fn repeat_str(s: &str, n: usize) -> String {
    s.repeat(n)
}

pub fn join(parts: &[&str], sep: &str) -> String {
    parts.join(sep)
}

pub fn replace(s: &str, from: &str, to: &str) -> String {
    s.replace(from, to)
}

pub fn parse_u32(s: &str) -> Option<u32> {
    s.parse().ok()
}

pub fn to_string_u32(n: u32) -> String {
    n.to_string()
}

pub fn min_u32(a: u32, b: u32) -> u32 {
    a.min(b)
}

pub fn max_u32(a: u32, b: u32) -> u32 {
    a.max(b)
}

pub fn abs_i32(n: i32) -> i32 {
    n.abs()
}

pub fn negate(n: i32) -> i32 {
    -n
}

pub fn square(n: u32) -> u32 {
    n * n
}

pub fn inc(n: u32) -> u32 {
    n + 1
}

pub fn dec(n: u32) -> u32 {
    n.saturating_sub(1)
}

pub fn mul(a: u32, b: u32) -> u32 {
    a * b
}

pub fn div_u32(a: u32, b: u32) -> u32 {
    if b == 0 { 0 } else { a / b }
}

pub fn mod_u32(a: u32, b: u32) -> u32 {
    if b == 0 { 0 } else { a % b }
}

pub fn xor_u8(a: u8, b: u8) -> u8 {
    a ^ b
}

pub fn and_u8(a: u8, b: u8) -> u8 {
    a & b
}

pub fn or_u8(a: u8, b: u8) -> u8 {
    a | b
}

pub fn not_u8(a: u8) -> u8 {
    !a
}

pub fn shl_u8(a: u8, bits: u32) -> u8 {
    a << bits
}

pub fn shr_u8(a: u8, bits: u32) -> u8 {
    a >> bits
}

pub fn popcount_u8(a: u8) -> u32 {
    a.count_ones()
}

pub fn leading_zeros_u8(a: u8) -> u32 {
    a.leading_zeros()
}

pub fn trailing_zeros_u8(a: u8) -> u32 {
    a.trailing_zeros()
}

pub fn rotate_left_u8(a: u8, bits: u32) -> u8 {
    a.rotate_left(bits)
}

pub fn rotate_right_u8(a: u8, bits: u32) -> u8 {
    a.rotate_right(bits)
}

pub fn swap_u8(a: u8, b: u8) -> (u8, u8) {
    (b, a)
}

pub fn clamp_i32(n: i32, lo: i32, hi: i32) -> i32 {
    n.clamp(lo, hi)
}

pub fn sign_i32(n: i32) -> i32 {
    if n > 0 { 1 } else if n < 0 { -1 } else { 0 }
}

pub fn is_power_of_two(n: u32) -> bool {
    n > 0 && n.is_power_of_two()
}

pub fn next_power_of_two(n: u32) -> u32 {
    n.next_power_of_two()
}

pub fn ilog2_u32(n: u32) -> u32 {
    n.ilog2()
}

pub fn gcd_u32(a: u32, b: u32) -> u32 {
    gcd(a, b)
}

pub fn lcm_u32(a: u32, b: u32) -> u32 {
    lcm(a, b)
}

// std has no integer gcd/lcm — Euclid's algorithm
fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

fn lcm(a: u32, b: u32) -> u32 {
    if a == 0 || b == 0 {
        0
    } else {
        a / gcd(a, b) * b
    }
}

pub fn to_hex_u32(n: u32) -> String {
    format!("{:x}", n)
}

pub fn from_hex_u32(s: &str) -> Option<u32> {
    u32::from_str_radix(s, 16).ok()
}

pub fn to_bin_u8(n: u8) -> String {
    format!("{:08b}", n)
}

pub fn from_bin_u8(s: &str) -> Option<u8> {
    u8::from_str_radix(s, 2).ok()
}

pub fn flip_bool(b: bool) -> bool {
    !b
}

pub fn pick<T>(cond: bool, a: T, b: T) -> T {
    if cond { a } else { b }
}

pub fn coalesce<T>(opt: Option<T>, fallback: T) -> T {
    opt.unwrap_or(fallback)
}

pub fn is_some<T>(opt: &Option<T>) -> bool {
    opt.is_some()
}

pub fn is_none<T>(opt: &Option<T>) -> bool {
    opt.is_none()
}

pub fn is_ok<T, E>(res: &Result<T, E>) -> bool {
    res.is_ok()
}

pub fn is_err<T, E>(res: &Result<T, E>) -> bool {
    res.is_err()
}

pub fn sum_u32(v: &[u32]) -> u32 {
    v.iter().sum()
}

pub fn vec_len<T>(v: &[T]) -> usize {
    v.len()
}

pub fn push_vec(v: &mut Vec<u32>, n: u32) {
    v.push(n);
}

pub fn pop_vec(v: &mut Vec<u32>) -> Option<u32> {
    v.pop()
}

pub fn sort_vec(v: &mut Vec<u32>) {
    v.sort();
}

pub fn dedup_vec(v: &mut Vec<u32>) {
    v.sort();
    v.dedup();
}

pub fn range_vec(start: u32, end: u32) -> Vec<u32> {
    (start..end).collect()
}

pub fn fill_vec(n: usize, value: u32) -> Vec<u32> {
    vec![value; n]
}

pub fn map_vec(v: &[u32]) -> Vec<u32> {
    v.iter().map(|x| x * 2).collect()
}

pub fn filter_vec(v: &[u32], min: u32) -> Vec<u32> {
    v.iter().copied().filter(|x| *x >= min).collect()
}

pub fn fold_vec(v: &[u32]) -> u32 {
    v.iter().fold(0, |acc, x| acc + *x)
}

pub fn max_in_vec(v: &[u32]) -> Option<u32> {
    v.iter().copied().max()
}

pub fn min_in_vec(v: &[u32]) -> Option<u32> {
    v.iter().copied().min()
}

pub fn avg_vec(v: &[u32]) -> Option<u32> {
    if v.is_empty() {
        None
    } else {
        Some(sum_u32(v) / v.len() as u32)
    }
}

pub fn reverse_copy_vec(v: &[u32]) -> Vec<u32> {
    v.iter().rev().copied().collect()
}

pub fn is_sorted_vec(v: &[u32]) -> bool {
    v.windows(2).all(|w| w[0] <= w[1])
}

pub fn zip_vec(a: &[u32], b: &[u32]) -> Vec<(u32, u32)> {
    a.iter().zip(b).map(|(x, y)| (*x, *y)).collect()
}

pub fn dot_vec(a: &[u32], b: &[u32]) -> u32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

pub fn clamp_vec(v: &[u32], lo: u32, hi: u32) -> Vec<u32> {
    v.iter().map(|x| (*x).clamp(lo, hi)).collect()
}

pub fn pct_u32(part: u32, whole: u32) -> u32 {
    if whole == 0 { 0 } else { part * 100 / whole }
}

pub fn lerp_u8(a: u8, b: u8, t: u8) -> u8 {
    let t = t as u32;
    let a = a as u32;
    let b = b as u32;
    ((a * (255 - t) + b * t) / 255) as u8
}

pub fn mid_u32(a: u32, b: u32) -> u32 {
    (a + b) / 2
}

pub fn between_u32(n: u32, lo: u32, hi: u32) -> bool {
    n >= lo && n <= hi
}

pub fn map_range_u32(n: u32, in_lo: u32, in_hi: u32, out_lo: u32, out_hi: u32) -> u32 {
    if in_hi == in_lo {
        return out_lo;
    }
    let scaled = (n - in_lo) as u64 * (out_hi - out_lo) as u64 / (in_hi - in_lo) as u64;
    out_lo + scaled as u32
}

pub fn char_count(s: &str) -> usize {
    s.chars().count()
}

pub fn first_char(s: &str) -> Option<char> {
    s.chars().next()
}

pub fn last_char(s: &str) -> Option<char> {
    s.chars().last()
}

pub fn is_empty(s: &str) -> bool {
    s.is_empty()
}

pub fn is_ascii(s: &str) -> bool {
    s.is_ascii()
}

pub fn to_bytes(s: &str) -> Vec<u8> {
    s.as_bytes().to_vec()
}

pub fn from_bytes(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

pub fn pad_left(s: &str, width: usize) -> String {
    format!("{:>width$}", s, width = width)
}

pub fn pad_right(s: &str, width: usize) -> String {
    format!("{:<width$}", s, width = width)
}

pub fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        s[..max].to_string()
    }
}

pub fn eq_u32(a: u32, b: u32) -> bool {
    a == b
}

pub fn ne_u32(a: u32, b: u32) -> bool {
    a != b
}

pub fn lt_u32(a: u32, b: u32) -> bool {
    a < b
}

pub fn gt_u32(a: u32, b: u32) -> bool {
    a > b
}

pub fn le_u32(a: u32, b: u32) -> bool {
    a <= b
}

pub fn ge_u32(a: u32, b: u32) -> bool {
    a >= b
}

pub fn abs_diff_u32(a: u32, b: u32) -> u32 {
    a.abs_diff(b)
}

pub fn byte_swap_u32(n: u32) -> u32 {
    n.swap_bytes()
}

pub fn to_le_bytes_u32(n: u32) -> [u8; 4] {
    n.to_le_bytes()
}

pub fn from_le_bytes_u32(bytes: [u8; 4]) -> u32 {
    u32::from_le_bytes(bytes)
}

pub fn to_be_bytes_u32(n: u32) -> [u8; 4] {
    n.to_be_bytes()
}

pub fn from_be_bytes_u32(bytes: [u8; 4]) -> u32 {
    u32::from_be_bytes(bytes)
}

pub fn count_bits_u32(n: u32) -> u32 {
    n.count_ones()
}

pub fn saturating_add_u8(a: u8, b: u8) -> u8 {
    a.saturating_add(b)
}

pub fn saturating_sub_u8(a: u8, b: u8) -> u8 {
    a.saturating_sub(b)
}

pub fn wrapping_add_u8(a: u8, b: u8) -> u8 {
    a.wrapping_add(b)
}

pub fn wrapping_sub_u8(a: u8, b: u8) -> u8 {
    a.wrapping_sub(b)
}

pub fn checked_add_u8(a: u8, b: u8) -> Option<u8> {
    a.checked_add(b)
}

pub fn checked_sub_u8(a: u8, b: u8) -> Option<u8> {
    a.checked_sub(b)
}

pub fn overflowing_add_u8(a: u8, b: u8) -> (u8, bool) {
    a.overflowing_add(b)
}

pub fn overflowing_sub_u8(a: u8, b: u8) -> (u8, bool) {
    a.overflowing_sub(b)
}

pub fn div_euclid_u32(a: u32, b: u32) -> u32 {
    a.div_euclid(b)
}

pub fn rem_euclid_u32(a: u32, b: u32) -> u32 {
    a.rem_euclid(b)
}

pub fn is_multiple_of_u32(a: u32, b: u32) -> bool {
    a.is_multiple_of(b)
}

pub fn div_ceil_u32(a: u32, b: u32) -> u32 {
    a.div_ceil(b)
}

pub fn div_floor_u32(a: u32, b: u32) -> u32 {
    // div_floor is unstable; unsigned division already rounds toward zero == floor
    a / b
}

pub fn widen_u8(n: u8) -> u16 {
    n as u16
}

pub fn narrow_u16(n: u16) -> u8 {
    n as u8
}

pub fn parse_i32(s: &str) -> Option<i32> {
    s.parse().ok()
}

pub fn both(a: bool, b: bool) -> bool {
    a && b
}

pub fn either(a: bool, b: bool) -> bool {
    a || b
}

pub fn xor_bool(a: bool, b: bool) -> bool {
    a ^ b
}

pub fn unwrap_or<T, E>(res: Result<T, E>, fallback: T) -> T {
    res.unwrap_or(fallback)
}

pub fn take_vec(v: &[u32], n: usize) -> Vec<u32> {
    v.iter().take(n).copied().collect()
}

pub fn skip_vec(v: &[u32], n: usize) -> Vec<u32> {
    v.iter().skip(n).copied().collect()
}
