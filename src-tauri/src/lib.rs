use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::imageops::FilterType as ResizeFilter;
use image::{DynamicImage, GenericImageView, ImageEncoder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufWriter, Cursor};
use std::path::{Path, PathBuf};
use tauri::Emitter;
use thiserror::Error;

#[derive(Debug, Error)]
enum ConverterError {
    #[error("Файл не удалось прочитать как изображение: {0}")]
    Image(#[from] image::ImageError),
    #[error("Ошибка файловой системы: {0}")]
    Io(#[from] std::io::Error),
    #[error("Не удалось определить имя файла: {0}")]
    MissingFileName(String),
    #[error("Некорректные размеры для изменения изображения")]
    InvalidResizeDimensions,
    #[error("Не удалось закодировать изображение в WebP: {0}")]
    WebpEncoder(String),
}

type ConverterResult<T> = Result<T, ConverterError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageInfo {
    path: String,
    file_name: String,
    extension: String,
    width: u32,
    height: u32,
    size_bytes: u64,
    preview_data_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvertRequest {
    input_path: String,
    format: OutputFormat,
    quality: u8,
    output_dir: Option<String>,
    resize_mode: ResizeMode,
    resize_width: Option<u32>,
    resize_height: Option<u32>,
    preserve_name: bool,
    suffix: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConversionProgress {
    input_path: String,
    percent: u8,
    message: String,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum OutputFormat {
    Webp,
    Jpeg,
    Png,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum ResizeMode {
    None,
    Width,
    Height,
    Fit,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvertResult {
    input_path: String,
    output_path: String,
    original_size_bytes: u64,
    output_size_bytes: u64,
    width: u32,
    height: u32,
    saved_percent: i64,
}

impl OutputFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Webp => "webp",
            Self::Jpeg => "jpg",
            Self::Png => "png",
        }
    }
}

#[tauri::command]
fn inspect_images(paths: Vec<String>) -> Result<Vec<ImageInfo>, String> {
    paths
        .iter()
        .map(|path| inspect_image(Path::new(path)).map_err(|error| error.to_string()))
        .collect()
}

#[tauri::command]
async fn convert_image(
    window: tauri::Window,
    request: ConvertRequest,
) -> Result<ConvertResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let input_path = request.input_path.clone();
        convert_single_image(request, |percent, message| {
            let _ = window.emit(
                "conversion-progress",
                ConversionProgress {
                    input_path: input_path.clone(),
                    percent,
                    message: message.to_owned(),
                },
            );
        })
    })
    .await
    .map_err(|error| format!("Не удалось запустить обработку: {error}"))?
    .map_err(|error| error.to_string())
}

fn inspect_image(path: &Path) -> ConverterResult<ImageInfo> {
    let (width, height) = image::image_dimensions(path)?;
    let metadata = fs::metadata(path)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ConverterError::MissingFileName(path.display().to_string()))?
        .to_owned();
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_owned();

    Ok(ImageInfo {
        path: path.display().to_string(),
        file_name,
        extension,
        width,
        height,
        size_bytes: metadata.len(),
        preview_data_url: thumbnail_data_url(path),
    })
}

fn thumbnail_data_url(path: &Path) -> Option<String> {
    let image = image::open(path).ok()?;
    let thumbnail = image.thumbnail(96, 96).to_rgba8();
    let mut bytes = Vec::new();
    {
        let writer = Cursor::new(&mut bytes);
        let encoder =
            PngEncoder::new_with_quality(writer, CompressionType::Fast, FilterType::Adaptive);
        encoder
            .write_image(
                thumbnail.as_raw(),
                thumbnail.width(),
                thumbnail.height(),
                image::ExtendedColorType::Rgba8,
            )
            .ok()?;
    }

    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn convert_single_image<F>(
    request: ConvertRequest,
    mut progress: F,
) -> ConverterResult<ConvertResult>
where
    F: FnMut(u8, &str),
{
    progress(5, "Подготовка файла");
    let input_path = Path::new(&request.input_path);
    let original_size_bytes = fs::metadata(input_path)?.len();
    progress(12, "Чтение изображения");
    let image = image::open(input_path)?;
    progress(28, "Расчет размера");
    let image = resize_image(image, &request)?;
    progress(45, "Подготовка результата");
    let output_path = output_path_for(&request)?;

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    progress(62, "Кодирование");
    encode_image(&image, &output_path, request.format, request.quality)?;
    progress(92, "Сохранение файла");

    let output_size_bytes = fs::metadata(&output_path)?.len();
    let (width, height) = image.dimensions();
    let saved_percent = if original_size_bytes == 0 {
        0
    } else {
        ((1.0 - output_size_bytes as f64 / original_size_bytes as f64) * 100.0).round() as i64
    };

    let result = ConvertResult {
        input_path: request.input_path,
        output_path: output_path.display().to_string(),
        original_size_bytes,
        output_size_bytes,
        width,
        height,
        saved_percent,
    };

    progress(100, "Готово");

    Ok(result)
}

fn resize_image(image: DynamicImage, request: &ConvertRequest) -> ConverterResult<DynamicImage> {
    let (width, height) = image.dimensions();
    let resized = match request.resize_mode {
        ResizeMode::None => image,
        ResizeMode::Width => {
            let target_width = request
                .resize_width
                .ok_or(ConverterError::InvalidResizeDimensions)?;
            let target_height = scaled_dimension(height, width, target_width)?;
            image.resize(target_width, target_height, ResizeFilter::Lanczos3)
        }
        ResizeMode::Height => {
            let target_height = request
                .resize_height
                .ok_or(ConverterError::InvalidResizeDimensions)?;
            let target_width = scaled_dimension(width, height, target_height)?;
            image.resize(target_width, target_height, ResizeFilter::Lanczos3)
        }
        ResizeMode::Fit => {
            let target_width = request
                .resize_width
                .ok_or(ConverterError::InvalidResizeDimensions)?;
            let target_height = request
                .resize_height
                .ok_or(ConverterError::InvalidResizeDimensions)?;
            if target_width == 0 || target_height == 0 {
                return Err(ConverterError::InvalidResizeDimensions);
            }
            image.resize(target_width, target_height, ResizeFilter::Lanczos3)
        }
    };

    Ok(resized)
}

fn scaled_dimension(source: u32, source_base: u32, target_base: u32) -> ConverterResult<u32> {
    if source_base == 0 || target_base == 0 {
        return Err(ConverterError::InvalidResizeDimensions);
    }
    Ok(((source as f64 / source_base as f64) * target_base as f64)
        .round()
        .max(1.0) as u32)
}

fn output_path_for(request: &ConvertRequest) -> ConverterResult<PathBuf> {
    let input_path = Path::new(&request.input_path);
    let parent = request
        .output_dir
        .as_ref()
        .map(PathBuf::from)
        .or_else(|| input_path.parent().map(Path::to_path_buf))
        .ok_or_else(|| ConverterError::MissingFileName(request.input_path.clone()))?;
    let stem = input_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| ConverterError::MissingFileName(request.input_path.clone()))?;
    let base_name = if request.preserve_name {
        format!("{}{}", stem, request.suffix)
    } else {
        format!("converted{}", request.suffix)
    };

    Ok(unique_path(parent.join(format!(
        "{}.{}",
        base_name,
        request.format.extension()
    ))))
}

fn unique_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image")
        .to_owned();
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_owned();

    for index in 1..10_000 {
        let file_name = if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    path
}

fn encode_image(
    image: &DynamicImage,
    output_path: &Path,
    format: OutputFormat,
    quality: u8,
) -> ConverterResult<()> {
    match format {
        OutputFormat::Webp => encode_webp(image, output_path, quality),
        OutputFormat::Jpeg => encode_jpeg(image, output_path, quality),
        OutputFormat::Png => encode_png(image, output_path, quality),
    }
}

fn encode_webp(image: &DynamicImage, output_path: &Path, quality: u8) -> ConverterResult<()> {
    let rgba = image.to_rgba8();
    let encoder = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height());
    let encoded = encoder
        .encode_simple(false, quality.clamp(1, 100) as f32)
        .map_err(|error| ConverterError::WebpEncoder(format!("{error:?}")))?;
    fs::write(output_path, &*encoded)?;
    Ok(())
}

fn encode_jpeg(image: &DynamicImage, output_path: &Path, quality: u8) -> ConverterResult<()> {
    let file = fs::File::create(output_path)?;
    let writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(writer, quality.clamp(1, 100));
    encoder.encode_image(&image.to_rgb8())?;
    Ok(())
}

fn encode_png(image: &DynamicImage, output_path: &Path, quality: u8) -> ConverterResult<()> {
    let file = fs::File::create(output_path)?;
    let writer = BufWriter::new(file);
    let compression = match quality {
        0..=55 => CompressionType::Best,
        56..=85 => CompressionType::Default,
        _ => CompressionType::Fast,
    };
    let encoder = PngEncoder::new_with_quality(writer, compression, FilterType::Adaptive);
    let rgba = image.to_rgba8();
    encoder.write_image(
        rgba.as_raw(),
        rgba.width(),
        rgba.height(),
        image::ExtendedColorType::Rgba8,
    )?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![inspect_images, convert_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GrayImage, Luma};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn encodes_luma_png_source_to_webp() {
        let image = DynamicImage::ImageLuma8(GrayImage::from_pixel(8, 8, Luma([180])));
        let output_path = std::env::temp_dir().join(format!(
            "image-service-webp-test-{}.webp",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be valid")
                .as_nanos()
        ));

        encode_webp(&image, &output_path, 82).expect("luma image should encode as webp");

        let metadata = fs::metadata(&output_path).expect("webp output should exist");
        assert!(metadata.len() > 0);
        let _ = fs::remove_file(output_path);
    }

    #[test]
    fn creates_thumbnail_data_url_for_queue_preview() {
        let image = DynamicImage::ImageLuma8(GrayImage::from_pixel(12, 12, Luma([120])));
        let input_path = std::env::temp_dir().join(format!(
            "image-service-preview-test-{}.png",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be valid")
                .as_nanos()
        ));

        image
            .save_with_format(&input_path, image::ImageFormat::Png)
            .expect("test png should be saved");

        let info = inspect_image(&input_path).expect("test image should be inspected");
        assert!(info
            .preview_data_url
            .expect("preview should exist")
            .starts_with("data:image/png;base64,"));

        let _ = fs::remove_file(input_path);
    }
}
