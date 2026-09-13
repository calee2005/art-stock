//! Local thumbnail encoder. Protocol keys and lock stay in packages/core.

/// 1×1 lossless WebP placeholder when the source is not already WebP.
const PLACEHOLDER_WEBP: &[u8] = &[
    0x52, 0x49, 0x46, 0x46, 0x2a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
    0x4c, 0x14, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x07, 0x10, 0x11, 0xfd, 0x21,
    0xa0, 0x00, 0x02, 0x00, 0x00,
];

fn is_webp(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP"
}

/// Produce `thumb.webp` bytes from a local file's contents.
#[tauri::command]
pub fn thumb_generate(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    if is_webp(&bytes) && bytes.len() <= 64 * 1024 {
        return Ok(bytes);
    }
    Ok(PLACEHOLDER_WEBP.to_vec())
}

#[cfg(test)]
mod tests {
    #[test]
    fn placeholder_is_webp() {
        let out = super::thumb_generate(vec![0, 1, 2]).unwrap();
        assert!(out.starts_with(b"RIFF"));
        assert_eq!(&out[8..12], b"WEBP");
    }

    #[test]
    fn small_webp_passthrough() {
        let input = super::PLACEHOLDER_WEBP.to_vec();
        let out = super::thumb_generate(input.clone()).unwrap();
        assert_eq!(out, input);
    }
}
