const { fetchSpotifyLyrics } = require('./dist/services/spotifyService');
const { updateTrackLyrics, getLibrary } = require('./dist/services/libraryService');

async function run() {
  const trackId = "QzpcVXNlcnNcU2ViYXNcTXVzaWNcQWx0YSB5IE1lZGlhIENhbGlkYWRcT2JsaXZpb24ncyBNaWdodHkgVHJhc2hcTE8tUE9DQUxZUFNFIExPT1BTXE9ibGl2aW9uJ3MgTWlnaHR5IFRyYXNoIC0gV2Fja3kuZmxhYw==";
  const spotifyTrackId = "1UnpwO2iy4KXj93e6Q1UYE";

  const lib = getLibrary();
  const track = lib.tracks.find(t => t.id === trackId);
  if (!track) {
    console.error("Track not found!");
    return;
  }

  try {
    const result = await fetchSpotifyLyrics(track.artist, track.title, spotifyTrackId);
    console.log("Fetch success. Synced:", result.synced);
    
    let plainLyrics = '';
    let syncedLyrics = null;

    if (result.synced) {
      syncedLyrics = result.lyrics;
      plainLyrics = result.lyrics.replace(/\[\d+:\d+\.\d+\]/g, '').trim();
    } else {
      plainLyrics = result.lyrics;
    }

    const updated = updateTrackLyrics(track.id, plainLyrics, syncedLyrics);
    console.log("Updated in DB:", updated);
  } catch (e) {
    console.error("Error:", e.message);
  }
}

run();
