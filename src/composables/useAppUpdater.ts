import { computed, onMounted, shallowRef, ref } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

type UpdaterStatus = "idle" | "checking" | "available" | "none" | "downloading" | "ready" | "error";

export function useAppUpdater() {
  const status = ref<UpdaterStatus>("idle");
  const update = shallowRef<Update | null>(null);
  const downloadedBytes = ref(0);
  const totalBytes = ref(0);
  const currentVersion = ref<string | null>(null);
  const errorMessage = ref<string | null>(null);

  const progress = computed(() => {
    if (totalBytes.value <= 0) return 0;
    return Math.min(100, Math.round((downloadedBytes.value / totalBytes.value) * 100));
  });

  const label = computed(() => {
    switch (status.value) {
      case "checking":
        return "Проверяем...";
      case "available":
        return `Доступна версия ${update.value?.version ?? ""}`;
      case "none":
        return "Обновлений нет";
      case "downloading":
        return `Скачиваем ${progress.value}%`;
      case "ready":
        return "Перезапустить";
      case "error":
        return "Ошибка обновления";
      default:
        return "Проверить обновления";
    }
  });

  const canCheck = computed(() => status.value === "idle" || status.value === "none" || status.value === "error");
  const canInstall = computed(() => status.value === "available");
  const canRelaunch = computed(() => status.value === "ready");
  const actionLabel = computed(() => {
    switch (status.value) {
      case "checking":
        return "Проверяем";
      case "available":
        return "Обновить";
      case "downloading":
        return "Установка";
      case "ready":
        return "Перезапустить";
      default:
        return "Проверить";
    }
  });
  const currentVersionLabel = computed(() =>
    currentVersion.value ? `Текущая версия ${currentVersion.value}` : "Текущая версия загружается",
  );

  async function loadCurrentVersion() {
    try {
      currentVersion.value = await getVersion();
    } catch {
      currentVersion.value = null;
    }
  }

  async function checkForUpdates() {
    if (status.value === "checking" || status.value === "downloading") return;

    status.value = "checking";
    errorMessage.value = null;
    downloadedBytes.value = 0;
    totalBytes.value = 0;

    try {
      update.value = await check();
      status.value = update.value ? "available" : "none";
    } catch (error) {
      status.value = "error";
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function installUpdate() {
    const availableUpdate = update.value;
    if (!availableUpdate) return;

    status.value = "downloading";
    errorMessage.value = null;
    downloadedBytes.value = 0;
    totalBytes.value = 0;

    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes.value = event.data.contentLength ?? 0;
        }

        if (event.event === "Progress") {
          downloadedBytes.value += event.data.chunkLength;
        }
      });

      status.value = "ready";
      await relaunchApp();
    } catch (error) {
      status.value = "error";
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function relaunchApp() {
    await relaunch();
  }

  async function handleUpdaterClick() {
    if (canRelaunch.value) {
      await relaunchApp();
      return;
    }

    if (canInstall.value) {
      await installUpdate();
      return;
    }

    if (canCheck.value) {
      await checkForUpdates();
    }
  }

  onMounted(() => {
    void loadCurrentVersion();
    void checkForUpdates();
  });

  return {
    status,
    update,
    progress,
    label,
    actionLabel,
    currentVersionLabel,
    errorMessage,
    handleUpdaterClick,
  };
}
