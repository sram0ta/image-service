export type OutputFormat = "webp" | "jpeg" | "png";

export type ResizeMode = "none" | "width" | "height" | "fit";

export interface ImageInfo {
  path: string;
  fileName: string;
  extension: string;
  width: number;
  height: number;
  sizeBytes: number;
  previewDataUrl: string | null;
}

export interface ConvertOptions {
  format: OutputFormat;
  quality: number;
  outputDir: string | null;
  resizeMode: ResizeMode;
  resizeWidth: number | null;
  resizeHeight: number | null;
  preserveName: boolean;
  suffix: string;
}

export interface ConvertRequest extends ConvertOptions {
  inputPath: string;
}

export interface ConvertResult {
  inputPath: string;
  outputPath: string;
  originalSizeBytes: number;
  outputSizeBytes: number;
  width: number;
  height: number;
  savedPercent: number;
}

export interface QueueItem {
  id: string;
  info: ImageInfo;
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  progressMessage: string | null;
  result: ConvertResult | null;
  error: string | null;
}

export interface ConversionProgressEvent {
  inputPath: string;
  percent: number;
  message: string;
}
