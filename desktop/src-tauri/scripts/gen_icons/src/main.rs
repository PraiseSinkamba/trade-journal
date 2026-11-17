use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = manifest_dir.parent().unwrap().parent().unwrap().join("icons");
    std::fs::create_dir_all(&out_dir).unwrap();

    // PNG bundle icons
    for (size, name) in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")] {
        let img = gen_candlestick_icon(size);
        write_png(out_dir.join(name), &img, size);
    }

    // ICO file with BMP entries (required for Windows rc.exe compatibility)
    let sizes = [16u32, 32, 48, 64, 128, 256];
    let bmp_datas: Vec<Vec<u8>> = sizes
        .iter()
        .map(|&sz| {
            let img = gen_candlestick_icon(sz);
            encode_bmp(&img, sz)
        })
        .collect();

    write_ico(out_dir.join("icon.ico"), &sizes, &bmp_datas);

    // icon.icns: PNG placeholder (macOS requires iconutil)
    let img256 = gen_candlestick_icon(256);
    std::fs::write(out_dir.join("icon.icns"), encode_png_to_vec(&img256, 256)).unwrap();

    println!("Icons written to {:?}", out_dir);
}

fn gen_candlestick_icon(size: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (size * size * 4) as usize];

    // Background: deep blue-gray #1a1f2e (BGRA)
    for y in 0..size {
        for x in 0..size {
            let idx = ((y * size + x) * 4) as usize;
            rgba[idx + 0] = 46;  // B
            rgba[idx + 1] = 31;  // G
            rgba[idx + 2] = 26;  // R
            rgba[idx + 3] = 255; // A
        }
    }

    let bar_w = std::cmp::max(1, size / 8);
    let spacing = size / 4;
    let origin_y = size * 3 / 4;

    let candles = [
        (size / 4, size / 6, size / 4, 60, 180, 100),   // green bull
        (size / 3, size / 5, size / 5, 220, 70, 70),    // red bear
        (size / 5, size / 4, size / 4, 60, 180, 100),   // green bull
    ];

    for (i, (body_h, wick_up, wick_down, r, g, b)) in candles.iter().enumerate() {
        let x = size / 4 + (i as u32) * spacing;
        let body_top = origin_y.saturating_sub(*body_h);
        let wick_top = origin_y.saturating_sub(*wick_up);
        let wick_w = std::cmp::max(1, bar_w / 3);
        let wick_x0 = x + (bar_w - wick_w) / 2;

        // Body
        for dy in 0..*body_h {
            for dx in 0..bar_w {
                let px = x + dx;
                let py = body_top + dy;
                if px < size && py < size {
                    let idx = ((py * size + px) * 4) as usize;
                    rgba[idx + 0] = *b as u8;
                    rgba[idx + 1] = *g as u8;
                    rgba[idx + 2] = *r as u8;
                    rgba[idx + 3] = 255;
                }
            }
        }

        // Upper wick
        for dy in 0..*wick_up {
            for dx in 0..wick_w {
                let px = wick_x0 + dx;
                let py = wick_top + dy;
                if px < size && py < size {
                    let idx = ((py * size + px) * 4) as usize;
                    rgba[idx + 0] = *b as u8;
                    rgba[idx + 1] = *g as u8;
                    rgba[idx + 2] = *r as u8;
                    rgba[idx + 3] = 255;
                }
            }
        }

        // Lower wick
        for dy in 0..*wick_down {
            for dx in 0..wick_w {
                let px = wick_x0 + dx;
                let py = origin_y + dy;
                if px < size && py < size {
                    let idx = ((py * size + px) * 4) as usize;
                    rgba[idx + 0] = *b as u8;
                    rgba[idx + 1] = *g as u8;
                    rgba[idx + 2] = *r as u8;
                    rgba[idx + 3] = 255;
                }
            }
        }
    }

    rgba
}

fn write_png(path: PathBuf, rgba: &[u8], size: u32) {
    let file = File::create(path).unwrap();
    let mut writer = BufWriter::new(file);
    write_png_stream(&mut writer, rgba, size);
    writer.flush().unwrap();
}

fn encode_bmp(rgba: &[u8], size: u32) -> Vec<u8> {
    // BITMAPINFOHEADER (40 bytes) + BGRA pixel data (bottom-up) + AND mask
    let row_size = (size * 4).next_multiple_of(4);
    let and_row_size = (((size + 7) / 8) + 3) & !3;
    let pixel_size = row_size * size;
    let and_size = and_row_size * size;
    let data_size = 40 + pixel_size + and_size;

    let mut buf = Vec::with_capacity(data_size as usize);

    // BITMAPINFOHEADER
    buf.extend_from_slice(&(40u32).to_le_bytes());        // header size
    buf.extend_from_slice(&(size as i32).to_le_bytes());   // width
    buf.extend_from_slice(&(size as i32 * 2).to_le_bytes()); // height (x2 for ICO: image + AND mask)
    buf.extend_from_slice(&(1u16).to_le_bytes());         // planes
    buf.extend_from_slice(&(32u16).to_le_bytes());        // bpp
    buf.extend_from_slice(&(0u32).to_le_bytes());         // compression BI_RGB
    buf.extend_from_slice(&(0u32).to_le_bytes());         // image size
    buf.extend_from_slice(&(0i32).to_le_bytes());         // x ppm
    buf.extend_from_slice(&(0i32).to_le_bytes());         // y ppm
    buf.extend_from_slice(&(0u32).to_le_bytes());         // colors used
    buf.extend_from_slice(&(0u32).to_le_bytes());         // important colors

    // Pixel data: bottom-up BGRA
    for y in (0..size).rev() {
        for x in 0..size {
            let idx = ((y * size + x) * 4) as usize;
            buf.push(rgba[idx + 0]); // B
            buf.push(rgba[idx + 1]); // G
            buf.push(rgba[idx + 2]); // R
            buf.push(rgba[idx + 3]); // A
        }
        // row padding
        for _ in 0..(row_size - size * 4) {
            buf.push(0);
        }
    }

    // AND mask: all zeros = fully opaque
    for _ in 0..and_size {
        buf.push(0);
    }

    buf
}

fn encode_png_to_vec(rgba: &[u8], size: u32) -> Vec<u8> {
    let mut buf = Vec::new();
    write_png_stream(&mut buf, rgba, size);
    buf
}

fn write_png_stream<W: Write>(w: &mut W, rgba: &[u8], size: u32) {
    // PNG signature
    w.write_all(&[137, 80, 78, 71, 13, 10, 26, 10]).unwrap();

    // IHDR chunk (13 bytes)
    let mut ihdr_data = Vec::with_capacity(13);
    ihdr_data.extend_from_slice(&(size as u32).to_be_bytes());
    ihdr_data.extend_from_slice(&(size as u32).to_be_bytes());
    ihdr_data.push(8);  // bit depth
    ihdr_data.push(6);  // color type RGBA
    ihdr_data.push(0);  // compression
    ihdr_data.push(0);  // filter
    ihdr_data.push(0);  // interlace
    write_chunk(w, b"IHDR", &ihdr_data);

    // IDAT chunk
    let mut raw_data = Vec::with_capacity(((size * 4 + 1) * size) as usize);
    for y in 0..size {
        raw_data.push(0); // filter: None
        for x in 0..size {
            let idx = ((y * size + x) * 4) as usize;
            raw_data.push(rgba[idx + 2]); // R
            raw_data.push(rgba[idx + 1]); // G
            raw_data.push(rgba[idx + 0]); // B
            raw_data.push(rgba[idx + 3]); // A
        }
    }
    let compressed = miniz_oxide::deflate::compress_to_vec(&raw_data, 6);
    write_chunk(w, b"IDAT", &compressed);

    // IEND
    write_chunk(w, b"IEND", &[]);
}

fn write_chunk<W: Write>(w: &mut W, typ: &[u8; 4], data: &[u8]) {
    let len = data.len() as u32;
    w.write_all(&len.to_be_bytes()).unwrap();
    w.write_all(typ).unwrap();
    w.write_all(data).unwrap();
    w.write_all(&crc32(typ, data).to_be_bytes()).unwrap();
}

fn crc32(typ: &[u8; 4], data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in typ.iter().chain(data.iter()) {
        crc = CRC_TABLE[((crc ^ b as u32) & 0xff) as usize] ^ (crc >> 8);
    }
    !crc
}

const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut i = 0u32;
    while i < 256 {
        let mut c = i;
        let mut k = 0u32;
        while k < 8 {
            c = if (c & 1) != 0 { 0xedb88320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        table[i as usize] = c;
        i += 1;
    }
    table
};

// ICO format: ICONDIR + ICONDIRENTRY[] + image data[]
fn write_ico(path: PathBuf, sizes: &[u32], pngs: &[Vec<u8>]) {
    let file = File::create(path).unwrap();
    let mut w = BufWriter::new(file);

    let count = sizes.len() as u16;
    let header_size = 6 + count as usize * 16;
    let mut offset = header_size as u32;

    // ICONDIR: u16 reserved, u16 type, u16 image count.
    w.write_all(&0u16.to_le_bytes()).unwrap();
    w.write_all(&1u16.to_le_bytes()).unwrap();
    w.write_all(&count.to_le_bytes()).unwrap();

    // ICONDIRENTRY for each image
    for (i, &sz) in sizes.iter().enumerate() {
        let png = &pngs[i];
        let wbyte = if sz == 256 { 0u8 } else { sz as u8 };
        let hbyte = if sz == 256 { 0u8 } else { sz as u8 };
        // Pack: width(1)+height(1)+colors(1)+reserved(1)+planes(2)+bpp(2) = 8 bytes header,
        // then size(4)+offset(4) = 16 bytes total
        let size_bytes = (png.len() as u32).to_le_bytes();
        let offset_bytes = offset.to_le_bytes();
        let mut entry_bytes = [0u8; 16];
        entry_bytes[0] = wbyte;
        entry_bytes[1] = hbyte;
        entry_bytes[2] = 0;  // colors
        entry_bytes[3] = 0;  // reserved
        entry_bytes[4] = 1;  // planes lo
        entry_bytes[5] = 0;  // planes hi
        entry_bytes[6] = 32; // bpp lo
        entry_bytes[7] = 0;  // bpp hi
        entry_bytes[8..12].copy_from_slice(&size_bytes);
        entry_bytes[12..16].copy_from_slice(&offset_bytes);
        w.write_all(&entry_bytes).unwrap();
        offset += png.len() as u32;
    }

    // Image data
    for png in pngs {
        w.write_all(png).unwrap();
    }

    w.flush().unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Parse the generated ICO directory exactly as Windows does.
    #[test]
    fn ico_directory_describes_six_valid_images() {
        let sizes = [16u32, 32, 48, 64, 128, 256];
        let images: Vec<Vec<u8>> = sizes
            .iter()
            .map(|&size| encode_bmp(&gen_candlestick_icon(size), size))
            .collect();
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "trade-journal-icon-test-{}-{unique}.ico",
            std::process::id()
        ));

        write_ico(path.clone(), &sizes, &images);
        let bytes = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();

        let reserved = u16::from_le_bytes(bytes[0..2].try_into().unwrap());
        let icon_type = u16::from_le_bytes(bytes[2..4].try_into().unwrap());
        let count = u16::from_le_bytes(bytes[4..6].try_into().unwrap());
        assert_eq!(reserved, 0);
        assert_eq!(icon_type, 1);
        assert_eq!(count as usize, sizes.len());

        let mut expected_offset = 6 + count as usize * 16;
        for (index, &size) in sizes.iter().enumerate() {
            let entry = 6 + index * 16;
            let expected_dimension = if size == 256 { 0 } else { size as u8 };
            assert_eq!(bytes[entry], expected_dimension);
            assert_eq!(bytes[entry + 1], expected_dimension);

            let image_size = u32::from_le_bytes(bytes[entry + 8..entry + 12].try_into().unwrap()) as usize;
            let image_offset = u32::from_le_bytes(bytes[entry + 12..entry + 16].try_into().unwrap()) as usize;
            assert_eq!(image_offset, expected_offset);
            assert!(image_offset + image_size <= bytes.len());
            expected_offset += image_size;
        }
    }
}
