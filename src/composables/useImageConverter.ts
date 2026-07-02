import { computed, nextTick, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ConvertOptions,
  ConvertRequest,
  ConvertResult,
  ConversionProgressEvent,
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

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "рассчитываем";
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds} сек`;
  return `${minutes} мин ${seconds.toString().padStart(2, "0")} сек`;
}

export function useImageConverter() {
  const items = ref<QueueItem[]>([]);
  const isProcessing = ref(false);
  const currentError = ref<string | null>(null);
  const activeRunIds = ref<string[]>([]);
  const elapsedMs = ref(0);
  const startedAt = ref<number | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let unlistenProgress: UnlistenFn | null = null;

  const options = ref<ConvertOptions>({
    format: "webp",
    quality: 82,
    outputDir: null,
    resizeMode: "none",
    resizeWidth: 1920,
    resizeHeight: 1080,
    lowResourceMode: true,
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
  const conversionProgress = computed(() => {
    if (activeRunIds.value.length === 0) return progress.value;

    const activeItems = activeRunIds.value
      .map((id) => items.value.find((item) => item.id === id))
      .filter((item): item is QueueItem => Boolean(item));

    if (activeItems.length === 0) return 0;

    const sum = activeItems.reduce((total, item) => total + item.progress, 0);
    return Math.min(100, Math.round(sum / activeItems.length));
  });
  const remainingTimeLabel = computed(() => {
    if (!isProcessing.value) return "0 сек";
    if (conversionProgress.value <= 0) return "рассчитываем";

    const remainingMs = (elapsedMs.value * (100 - conversionProgress.value)) / conversionProgress.value;
    return formatDuration(remainingMs);
  });
  const elapsedTimeLabel = computed(() => formatDuration(elapsedMs.value));
  const currentProcessingItem = computed(
    () => items.value.find((item) => item.status === "processing") ?? null,
  );
  const conversionSummary = computed(() => {
    const total = activeRunIds.value.length || items.value.length;
    const processed = activeRunIds.value.length
      ? activeRunIds.value.filter((id) => {
          const item = items.value.find((candidate) => candidate.id === id);
          return item?.status === "done" || item?.status === "error";
        }).length
      : completedCount.value + failedCount.value;

    return `${processed} из ${total}`;
  });

  listen<ConversionProgressEvent>("conversion-progress", (event) => {
    const item = items.value.find((candidate) => candidate.info.path === event.payload.inputPath);
    if (!item) return;

    item.progress = Math.max(0, Math.min(100, event.payload.percent));
    item.progressMessage = event.payload.message;
  }).then((unlisten) => {
    unlistenProgress = unlisten;
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
    unlistenProgress?.();
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
          progress: 0,
          progressMessage: null,
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
    activeRunIds.value = [];
    elapsedMs.value = 0;
    startedAt.value = null;
  }

  function setFormat(format: OutputFormat) {
    options.value.format = format;
  }

  async function convertAll() {
    if (items.value.length === 0 || isProcessing.value) return;
    const runItems = items.value.filter((item) => item.status !== "done");
    if (runItems.length === 0) return;

    isProcessing.value = true;
    currentError.value = null;
    activeRunIds.value = runItems.map((item) => item.id);
    elapsedMs.value = 0;
    startedAt.value = Date.now();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (startedAt.value) elapsedMs.value = Date.now() - startedAt.value;
    }, 250);

    for (const item of runItems) {
      item.status = "processing";
      item.error = null;
      item.result = null;
      item.progress = 1;
      item.progressMessage = "Подготовка";

      await nextTick();
      await waitForPaint();

      const request: ConvertRequest = {
        ...options.value,
        inputPath: item.info.path,
      };

      try {
        item.result = await invoke<ConvertResult>("convert_image", { request });
        item.progress = 100;
        item.progressMessage = "Готово";
        item.status = "done";
      } catch (error) {
        item.progress = 100;
        item.progressMessage = "Ошибка";
        item.status = "error";
        item.error = error instanceof Error ? error.message : String(error);
      }
    }

    isProcessing.value = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (startedAt.value) elapsedMs.value = Date.now() - startedAt.value;
    startedAt.value = null;
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
    conversionProgress,
    conversionSummary,
    elapsedTimeLabel,
    remainingTimeLabel,
    currentProcessingItem,
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
