const axios = require('axios');

async function test() {
  try {
    const query = encodeURIComponent("Mac DeMarco I've Been Waiting for Her spotify track");
    const res = await axios.get(`https://www.bing.com/search?q=${query}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    console.log('Bing Status:', res.status);
    
    // Look for any mention of spotify
    const regex = /spotify[a-zA-Z0-9.\-_/%?=&]+/gi;
    const matches = res.data.match(regex);
    console.log('Matches length:', matches ? matches.length : 0);
    if (matches) {
      console.log('Sample matches:', matches.slice(0, 10));
    }

    // Try finding spotify track links specifically
    const trackRegex = /spotify\.com[a-zA-Z0-9.\-_/%?=&]*track[a-zA-Z0-9.\-_/%?=&]*/gi;
    const trackMatches = res.data.match(trackRegex);
    console.log('Track matches:', trackMatches);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
