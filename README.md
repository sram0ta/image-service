# Image Service

Локальное desktop-приложение для конвертации, изменения размера и сжатия изображений на macOS и Windows.

## Стек

- Vue 3 + TypeScript + Vite для интерфейса
- Tauri 2 для desktop-оболочки
- Rust для локальной обработки изображений
- `image` и `webp` для декодирования, resize и кодирования
- Tauri updater для обновления приложения через GitHub Releases

## Возможности

- Полностью локальная обработка без сервера и загрузки файлов
- Нативный выбор файлов и папки сохранения
- Очередь для batch-конвертации
- Форматы вывода: WebP, JPEG и PNG
- Слайдер качества от 1 до 100
- Resize: оригинал, ширина, высота, вписать в размеры
- Проверка и установка обновлений внутри приложения

## Разработка

```bash
npm install
npm run tauri:dev
```

Frontend-only build:

```bash
npm run build
```

Rust check:

```bash
cd src-tauri
cargo check
```

## Локальная подписанная сборка

Ключи updater лежат локально в `.tauri/` и не попадают в git.

```bash
npm run tauri:build:signed
```

## GitHub Secrets для релизов

Один раз добавь secrets в GitHub:

```bash
npm run release:secrets
```

Скрипт покажет значения для:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Добавлять здесь:

```text
GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret
```

## Как выпустить релиз

1. Подготовить версию:

```bash
npm run release:prepare -- 0.2.0
```

2. Закоммитить изменения:

```bash
git add .
git commit -m "Release v0.2.0"
```

3. Поставить тег и отправить:

```bash
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

После push тега GitHub Actions соберет macOS и Windows версии, прикрепит файлы к GitHub Release и создаст updater-артефакты. Приложение проверяет:

```text
https://github.com/sram0ta/image-service/releases/latest/download/latest.json
```

Если репозиторий будет называться иначе, поменяй endpoint в `src-tauri/tauri.conf.json`.

## Если macOS пишет “приложение повреждено”

Это системная защита macOS для приложений, скачанных из интернета без подтвержденной подписи разработчика.

Для текущего локального теста можно снять quarantine:

```bash
xattr -dr com.apple.quarantine "/Applications/Image Service.app"
```

Если приложение еще на смонтированном `.dmg`, сначала перетащи его в `Applications`.

Для текущих релизов это ожидаемое ограничение macOS.
