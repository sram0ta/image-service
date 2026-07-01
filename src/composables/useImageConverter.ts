import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ConvertOptions,
  ConvertRequest,
  ConvertResult,
  ImageInfo,
  OutputFormat,
  QueueItem,
} from "../types/converter";

const imageFilters = [
  {
    name: "Изображения",
    extensions: ["png", "jpg", "jpeg", "webp"],
  },
];

function makeId(path: string) {
  return `${path}-${crypto.randomUUID()}`;
}

function normalizeSelection(selected: string | string[] | null): string[] {
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export function useImageConverter() {
  const items = ref<QueueItem[]>([]);
  const isProcessing = ref(false);
  const currentError = ref<string | null>(null);

  const options = ref<ConvertOptions>({
    format: "webp",
    quality: 82,
    outputDir: null,
    resizeMode: "none",
    resizeWidth: 1920,
    resizeHeight: 1080,
    preserveName: true,
    suffix: "-optimized",
  });

  const completedCount = computed(
    () => items.value.filter((item) => item.status === "done").length,
  );
  const failedCount = computed(
    () => items.value.filter((item) => item.status === "error").length,
  );
  const totalOriginalBytes = computed(() =>
    items.value.reduce((sum, item) => sum + item.info.sizeBytes, 0),
  );
  const totalOutputBytes = computed(() =>
    items.value.reduce((sum, item) => sum + (item.result?.outputSizeBytes ?? 0), 0),
  );
  const totalSavedPercent = computed(() => {
    if (totalOriginalBytes.value === 0 || totalOutputBytes.value === 0) return 0;
    return Math.max(
      0,
      Math.round((1 - totalOutputBytes.value / totalOriginalBytes.value) * 100),
    );
  });
  const progress = computed(() => {
    if (items.value.length === 0) return 0;
    return Math.round(((completedCount.value + failedCount.value) / items.value.length) * 100);
  });

  async function inspect(paths: string[]) {
    if (paths.length === 0) return;
    currentError.value = null;
    try {
      const infos = await invoke<ImageInfo[]>("inspect_images", { paths });
      const existing = new Set(items.value.map((item) => item.info.path));
      const nextItems = infos
        .filter((info) => !existing.has(info.path))
        .map((info) => ({
          id: makeId(info.path),
          info,
          status: "queued" as const,
          result: null,
          error: null,
        }));

      items.value = [...items.value, ...nextItems];
    } catch (error) {
      currentError.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function pickFiles() {
    const selected = await open({
      title: "Выберите изображения",
      multiple: true,
      filters: imageFilters,
    });
    await inspect(normalizeSelection(selected));
  }

  async function pickOutputDir() {
    const selected = await open({
      title: "Выберите папку сохранения",
      directory: true,
      multiple: false,
      canCreateDirectories: true,
    });
    const [folder] = normalizeSelection(selected);
    if (folder) options.value.outputDir = folder;
  }

  function removeItem(id: string) {
    items.value = items.value.filter((item) => item.id !== id);
  }

  function clearFinished() {
    items.value = items.value.filter((item) => item.status !== "done");
  }

  function resetQueue() {
    items.value = [];
    currentError.value = null;
  }

  function setFormat(format: OutputFormat) {
    options.value.format = format;
  }

  async function convertAll() {
    if (items.value.length === 0 || isProcessing.value) return;
    isProcessing.value = true;
    currentError.value = null;

    for (const item of items.value) {
      if (item.status === "done") continue;

      item.status = "processing";
      item.error = null;
      item.result = null;

      const request: ConvertRequest = {
        ...options.value,
        inputPath: item.info.path,
      };

      try {
        item.result = await invoke<ConvertResult>("convert_image", { request });
        item.status = "done";
      } catch (error) {
        item.status = "error";
        item.error = error instanceof Error ? error.message : String(error);
      }
    }

    isProcessing.value = false;
  }

  return {
    items,
    options,
    isProcessing,
    currentError,
    completedCount,
    failedCount,
    totalOriginalBytes,
    totalOutputBytes,
    totalSavedPercent,
    progress,
    inspect,
    pickFiles,
    pickOutputDir,
    removeItem,
    clearFinished,
    resetQueue,
    setFormat,
    convertAll,
  };
}
