# Physicalcyon

A Rails 8 web application for uploading STEP CAD files, converting them to glTF, and viewing them interactively in the browser via a Three.js 3D viewer with live status updates.

## Stack

- **Ruby** 3.4.2 / **Rails** 8.1.2
- **SQLite3** — three separate databases (primary, queue, cable)
- **Tailwind CSS v4** — via tailwindcss-rails
- **Hotwire** (Turbo + Stimulus) — live updates and interactive controllers
- **Solid Queue** — background job processing
- **Solid Cable** — Action Cable adapter (enables Turbo Stream broadcasts across processes)
- **Active Storage** — STEP file, glTF, and thumbnail storage
- **Three.js 0.169** — in-browser 3D model viewer via importmap
- **pythonocc-core** — Python/OpenCASCADE library for STEP → glTF conversion

## Features

- Upload `.step` / `.stp` CAD files
- Background conversion to glTF 2.0 (tessellation via OpenCASCADE)
- Live status updates on the show page via Turbo Streams (no polling)
- Interactive 3D viewer with orbit controls (drag to rotate, scroll to zoom)
- Thumbnail generation (falls back to placeholder if no display available)
- Status badges: Queued → Converting → Done / Failed

## System Requirements

- Ruby 3.4.2 (via RVM)
- Python via Miniconda with `pythonocc-core` installed
- Node not required (importmap)
- SQLite3

**Note:** SQLite WAL mode is disabled (`journal_mode: delete`) for WSL1 compatibility. This is safe to leave in place on any environment.

## Setup

### 1. Ruby dependencies

```bash
bundle install
```

### 2. Python / pythonocc-core

```bash
# Install Miniconda (if not already installed)
curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o /tmp/miniconda.sh
bash /tmp/miniconda.sh -b -p ~/miniconda3

# Install pythonocc-core
~/miniconda3/bin/conda install -y -c conda-forge pythonocc-core
```

### 3. Database setup

```bash
bin/rails active_storage:install
bin/rails db:migrate
bin/rails db:schema:load:queue
bin/rails db:schema:load:cable
```

### 4. Start the development server

```bash
bin/dev
```

This starts three processes via Foreman:
- `web` — Puma Rails server
- `css` — Tailwind CSS watcher
- `worker` — Solid Queue background worker

Then visit [http://localhost:3000](http://localhost:3000).

## How it works

1. User uploads a `.step` file at `/cad_models/new`
2. On save, `ConvertStepJob` is enqueued via Solid Queue
3. The show page subscribes to a Turbo Stream channel and shows a spinner
4. The worker picks up the job, calls `lib/step_to_gltf.py` via `Open3`
5. The Python script reads the STEP file with `STEPControl_Reader`, tessellates with `BRepMesh_IncrementalMesh`, and writes a self-contained glTF 2.0 JSON (geometry embedded as base64)
6. On success, the glTF and thumbnail are attached via Active Storage and status is set to `done`
7. The `after_update_commit` callback broadcasts a Turbo Stream replace, updating the page live
8. The `model-viewer` Stimulus controller initialises a Three.js scene and loads the glTF

## Key files

| File | Purpose |
|------|---------|
| `app/models/cad_model.rb` | Enum status, attachments, broadcast callback |
| `app/jobs/convert_step_job.rb` | Solid Queue job — orchestrates the conversion |
| `lib/step_to_gltf.py` | Python script — STEP → glTF via pythonocc-core |
| `app/javascript/controllers/model_viewer_controller.js` | Three.js Stimulus controller |
| `app/views/cad_models/_status.html.erb` | Live-updating status/viewer partial |
| `config/importmap.rb` | Three.js + GLTFLoader + OrbitControls pins |
| `config/database.yml` | Multi-database config (primary / queue / cable) |
