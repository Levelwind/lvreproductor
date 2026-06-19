# Level Player

Level Player is a local music player and metadata downloader. It allows scanning local music libraries, streaming audio, fetching lyrics from public APIs, and downloading tracks using Tidal integration.

## Project Structure

* frontend: React + Vite + Howler.js interface.
* backend: Node.js + Express server for scanning library, streaming, and metadata.
* scripts: Python scripts for Tidal downloads and Canvas synchronization.

## Setup

1. Clone the repository.
2. In the backend directory:
   * Copy `src/config.json.example` to `src/config.json` and fill in your credentials.
   * Run `npm install` to install dependencies.
   * Start the backend using `npm run dev` or the provided startup script.
3. In the frontend directory:
   * Run `npm install`.
   * Start the development server using `npm run dev`.
4. In the scripts directory:
   * Ensure Python 3 is installed with necessary libraries (`requests`, etc.).
