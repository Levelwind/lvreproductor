const axios = require('axios');

async function test() {
  try {
    const res = await axios.get('https://itunes.apple.com/search?term=Mac+DeMarco+I+ve+Been+Waiting+for+Her&entity=song&limit=1');
    console.log('iTunes Data:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
