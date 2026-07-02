<script setup lang="ts">
import {
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  ImagePlus,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  X,
} from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow, type DragDropEvent } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useAppUpdater } from "./composables/useAppUpdater";
import { useImageConverter } from "./composables/useImageConverter";
import type { OutputFormat, ResizeMode } from "./types/converter";

const {
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
} = useImageConverter();

const {
  status: updaterStatus,
  progress: updaterProgress,
  label: updaterLabel,
  actionLabel: updaterActionLabel,
  currentVersionLabel,
  errorMessage: updaterError,
  handleUpdaterClick,
} = useAppUpdater();

const isDragging = ref(false);
let unlistenNativeDrop: UnlistenFn | null = null;

const formats: Array<{ value: OutputFormat; label: string; hint: string }> = [
  { value: "webp", label: "WebP", hint: "Формат для сайта" },
  { value: "jpeg", label: "JPEG", hint: "" },
  { value: "png", label: "PNG", hint: "" },
];

const resizeModes: Array<{ value: ResizeMode; label: string }> = [
  { value: "none", label: "Оригинал" },
  { value: "width", label: "Ширина" },
  { value: "height", label: "Высота" },
  { value: "fit", label: "Вписать" },
];

const hasItems = computed(() => items.value.length > 0);
const canConvert = computed(() => hasItems.value && !isProcessing.value);
const qualityLabel = computed(() => {
  if (options.value.quality >= 90) return "Отличное";
  if (options.value.quality >= 75) return "Хорошее";
  if (options.value.quality >= 55) return "Удовлетворительное";
  return "Искажения и пиксели";
});
const outputLabel = computed(() => options.value.outputDir ?? "Сохранять рядом с оригиналом");
const statusLabels = {
  queued: "В очереди",
  processing: "Обработка",
  done: "Готово",
  error: "Ошибка",
};
const supportedImageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function fileShortName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function imagePathsOnly(paths: string[]) {
  return paths.filter((path) => {
    const extension = path.split(".").pop()?.toLowerCase();
    return extension ? supportedImageExtensions.has(extension) : false;
  });
}

async function onDrop(event: DragEvent) {
  isDragging.value = false;
  const paths = Array.from(event.dataTransfer?.files ?? [])
    .map((file) => {
      const candidate = file as File & { path?: string };
      return candidate.path;
    })
    .filter((path): path is string => Boolean(path));

  const imagePaths = imagePathsOnly(paths);
  if (imagePaths.length > 0) {
    await inspect(imagePaths);
  }
}

async function handleNativeDrop(event: { payload: DragDropEvent }) {
  if (event.payload.type === "enter" || event.payload.type === "over") {
    isDragging.value = true;
    return;
  }

  if (event.payload.type === "leave") {
    isDragging.value = false;
    return;
  }

  isDragging.value = false;
  const imagePaths = imagePathsOnly(event.payload.paths);
  if (imagePaths.length > 0) {
    await inspect(imagePaths);
  }
}

onMounted(async () => {
  unlistenNativeDrop = await getCurrentWindow().onDragDropEvent((event) => {
    void handleNativeDrop(event);
  });
});

onUnmounted(() => {
  unlistenNativeDrop?.();
});
</script>

<template>
  <main class="app-shell">
    <section class="workspace">
      <aside class="settings-panel">
        <div class="brand-block">
          <div class="brand-mark">
            <Settings2 :size="22" />
          </div>
          <div>
            <p class="eyebrow">Локальный конвертер</p>
            <h1>Image Service</h1>
          </div>
        </div>

        <div class="update-card">
          <div>
            <span>Обновления</span>
            <strong>{{ updaterLabel }}</strong>
            <small>{{ currentVersionLabel }}</small>
          </div>
          <button
            type="button"
            :disabled="updaterStatus === 'checking' || updaterStatus === 'downloading'"
            @click="handleUpdaterClick"
          >
            <Loader2 v-if="updaterStatus === 'checking' || updaterStatus === 'downloading'" class="spin" :size="17" />
            <RefreshCw v-else :size="17" />
            <span>{{ updaterActionLabel }}</span>
          </button>
          <div v-if="updaterStatus === 'downloading'" class="update-progress">
            <span :style="{ width: `${updaterProgress}%` }" />
          </div>
          <p v-if="updaterError">{{ updaterError }}</p>
        </div>

        <div class="control-group">
          <div class="control-heading">
            <span>Формат вывода</span>
          </div>
          <div class="format-grid">
            <button
              v-for="format in formats"
              :key="format.value"
              class="format-button"
              :class="{ active: options.format === format.value }"
              type="button"
              @click="setFormat(format.value)"
            >
              <strong>{{ format.label }}</strong>
              <span>{{ format.hint }}</span>
            </button>
          </div>
        </div>

        <div class="control-group">
          <div class="control-heading">
            <span>Качество</span>
            <strong>{{ options.quality }}%</strong>
          </div>
          <input
            v-model.number="options.quality"
            class="quality-range"
            type="range"
            min="1"
            max="100"
            step="1"
          />
          <div class="range-meta">
            <span>Хуже</span>
            <strong>{{ qualityLabel }}</strong>
            <span>Лучше</span>
          </div>
        </div>

        <div class="control-group">
          <div class="control-heading">
            <span>Размер</span>
          </div>
          <div class="segmented">
            <button
              v-for="mode in resizeModes"
              :key="mode.value"
              type="button"
              :class="{ active: options.resizeMode === mode.value }"
              @click="options.resizeMode = mode.value"
            >
              {{ mode.label }}
            </button>
          </div>
          <div v-if="options.resizeMode !== 'none'" class="dimension-grid">
            <label v-if="options.resizeMode === 'width' || options.resizeMode === 'fit'">
              <span>Ширина</span>
              <input v-model.number="options.resizeWidth" type="number" min="1" />
            </label>
            <label v-if="options.resizeMode === 'height' || options.resizeMode === 'fit'">
              <span>Высота</span>
              <input v-model.number="options.resizeHeight" type="number" min="1" />
            </label>
          </div>
        </div>

        <div class="control-group">
          <div class="control-heading">
            <span>Производительность</span>
          </div>
          <label class="toggle-line">
            <input v-model="options.lowResourceMode" type="checkbox" />
            <span>Экономный режим</span>
          </label>
        </div>

        <div class="control-group">
          <div class="control-heading">
            <span>Имена файлов</span>
          </div>
          <label class="toggle-line">
            <input v-model="options.preserveName" type="checkbox" />
            <span>Сохранять имя оригинала</span>
          </label>
          <label class="field-line">
            <span>Суффикс</span>
            <input v-model="options.suffix" type="text" placeholder="-optimized" />
          </label>
        </div>

        <div class="output-box">
          <span>{{ outputLabel }}</span>
          <button type="button" @click="pickOutputDir">
            <FolderOpen :size="17" />
            Папка
          </button>
        </div>
      </aside>

      <section class="main-panel">
        <header class="top-bar">
          <div>
            <p class="eyebrow">Только локальная обработка</p>
            <h2>Конвертация и сжатие изображений</h2>
          </div>
          <div class="top-actions">
            <button class="ghost-button" type="button" :disabled="!hasItems" @click="resetQueue">
              <RotateCcw :size="18" />
              Сброс
            </button>
            <button class="primary-button" type="button" :disabled="!canConvert" @click="convertAll">
              <Loader2 v-if="isProcessing" class="spin" :size="18" />
              <Play v-else :size="18" />
              Конвертировать
            </button>
          </div>
        </header>

        <section class="stats-row">
          <div>
            <span>Файлы</span>
            <strong>{{ items.length }}</strong>
          </div>
          <div>
            <span>Готово</span>
            <strong>{{ completedCount }}</strong>
          </div>
          <div>
            <span>Исходный вес</span>
            <strong>{{ formatBytes(totalOriginalBytes) }}</strong>
          </div>
          <div>
            <span>Результат</span>
            <strong>{{ totalOutputBytes ? formatBytes(totalOutputBytes) : "..." }}</strong>
          </div>
          <div>
            <span>Экономия</span>
            <strong>{{ totalSavedPercent }}%</strong>
          </div>
        </section>

        <div v-if="isProcessing || completedCount || failedCount" class="progress-block">
          <div class="progress-heading">
            <strong>
              {{ isProcessing ? "Конвертация" : "Последняя обработка" }}
            </strong>
            <span>{{ isProcessing ? conversionSummary : `${progress}%` }}</span>
          </div>
          <div class="progress-track">
            <span :style="{ width: `${isProcessing ? conversionProgress : progress}%` }" />
          </div>
          <div class="progress-meta">
            <p>
              Обработано {{ isProcessing ? conversionProgress : progress }}%
              <span v-if="currentProcessingItem">
                · {{ currentProcessingItem.info.fileName }}
              </span>
            </p>
            <p v-if="isProcessing">
              Прошло {{ elapsedTimeLabel }} · осталось {{ remainingTimeLabel }}
            </p>
          </div>
        </div>

        <section
          class="drop-zone"
          :class="{ dragging: isDragging }"
          @dragenter.prevent="isDragging = true"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
        >
          <div class="drop-icon">
            <ImagePlus :size="28" />
          </div>
          <div>
            <h3>Перетащите изображения сюда</h3>
            <p>Поддерживаются PNG, JPEG и WebP.</p>
          </div>
          <button type="button" @click="pickFiles">Выбрать файлы</button>
        </section>

        <p v-if="currentError" class="error-banner">{{ currentError }}</p>

        <section v-if="hasItems" class="queue-panel">
          <div class="queue-header">
            <h3>Очередь</h3>
            <button type="button" :disabled="completedCount === 0" @click="clearFinished">
              Убрать готовые
            </button>
          </div>

          <div class="queue-list">
            <article v-for="item in items" :key="item.id" class="queue-item">
              <div class="file-badge">
                <img
                  v-if="item.info.previewDataUrl"
                  :src="item.info.previewDataUrl"
                  :alt="`Превью ${item.info.fileName}`"
                  loading="lazy"
                />
                <span>{{ item.info.extension.toUpperCase() }}</span>
              </div>
              <div class="file-main">
                <div class="file-title">
                  <strong>{{ item.info.fileName }}</strong>
                  <span>{{ item.info.width }} x {{ item.info.height }}</span>
                </div>
                <div class="file-meta">
                  <span>{{ formatBytes(item.info.sizeBytes) }}</span>
                  <span v-if="item.result">→ {{ formatBytes(item.result.outputSizeBytes) }}</span>
                  <span v-if="item.result">{{ fileShortName(item.result.outputPath) }}</span>
                  <span v-if="item.status === 'processing' && item.progressMessage">
                    {{ item.progressMessage }}
                  </span>
                  <span v-if="item.error" class="file-error">{{ item.error }}</span>
                </div>
              </div>
              <div class="status-pill" :class="item.status">
                <Loader2 v-if="item.status === 'processing'" class="spin" :size="16" />
                <CheckCircle2 v-else-if="item.status === 'done'" :size="16" />
                <X v-else-if="item.status === 'error'" :size="16" />
                <span>
                  {{ item.status === "processing" ? `${item.progress}%` : statusLabels[item.status] }}
                </span>
              </div>
              <button
                class="icon-button"
                type="button"
                :disabled="isProcessing"
                :title="`Удалить ${item.info.fileName}`"
                @click="removeItem(item.id)"
              >
                <Trash2 :size="17" />
              </button>
            </article>
          </div>
        </section>
      </section>
    </section>
  </main>
</template>
