const axios = require('axios');

async function test() {
  try {
    const query = encodeURIComponent("Mac DeMarco I've Been Waiting for Her spotify track");
    const res = await axios.get(`https://search.yahoo.com/search?p=${query}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    console.log('Yahoo Status:', res.status);
    
    // Look for any mention of spotify
    const regex = /spotify[a-zA-Z0-9.\-_/%?=&]+/gi;
    const matches = res.data.match(regex);
    console.log('Matches count:', matches ? matches.length : 0);
    if (matches) {
      console.log('Sample matches:', matches.slice(0, 15));
    }

    // Try finding redirect urls containing spotify
    const redirectRegex = /https%3a%2f%2fopen\.spotify\.com%2ftrack%2f([a-zA-Z0-9]+)/gi;
    const redirectMatches = [...res.data.matchAll(redirectRegex)];
    console.log('Redirect track matches count:', redirectMatches.length);
    if (redirectMatches.length > 0) {
      console.log('First redirect match ID:', redirectMatches[0][1]);
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
