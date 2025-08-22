const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`;

const TOKEN_FILE = '/app/data/spotify_tokens.json';
let spotifyTokens = {
  access_token: null,
  refresh_token: null,
  expires_at: null
};

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, 'utf8');
      spotifyTokens = JSON.parse(data);
      console.log('Loaded existing Spotify tokens');
    }
  } catch (error) {
    console.log('No existing tokens found, will need authentication');
  }
}

function saveTokens() {
  try {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(TOKEN_FILE, JSON.stringify(spotifyTokens, null, 2));
  } catch (error) {
    console.error('Failed to save tokens:', error.message);
  }
}

loadTokens();

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

function formatForMobile(artist, songTitle) {
  const maxLength = 25;

  if (songTitle.length <= maxLength) {
    return `♪ ${songTitle}`;
  }

  if (songTitle.length > maxLength - 2) {
    return `♪ ${songTitle.substring(0, maxLength - 5)}...`;
  }

  const shortFormat = `♪ ${artist.split(' ')[0]} - ${songTitle}`;
  if (shortFormat.length <= maxLength) {
    return shortFormat;
  }

  return `♪ ${songTitle.substring(0, maxLength - 5)}...`;
}

async function refreshAccessToken() {
  if (!spotifyTokens.refresh_token) {
    throw new Error('No refresh token available');
  }

  const fetch = (await import('node-fetch')).default;

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: spotifyTokens.refresh_token
    })
  });

  const data = await response.json();

  if (data.access_token) {
    spotifyTokens.access_token = data.access_token;
    spotifyTokens.expires_at = Date.now() + (data.expires_in * 1000);
    if (data.refresh_token) {
      spotifyTokens.refresh_token = data.refresh_token;
    }
    saveTokens();
    console.log('Spotify token refreshed');
    return data.access_token;
  }

  throw new Error('Failed to refresh token');
}

async function getValidAccessToken() {
  if (spotifyTokens.access_token && spotifyTokens.expires_at && Date.now() < spotifyTokens.expires_at) {
    return spotifyTokens.access_token;
  }

  if (spotifyTokens.refresh_token) {
    try {
      return await refreshAccessToken();
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
  }

  return null;
}

app.get('/api/spotify/current-track', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();

    if (!accessToken) {
      return res.json({
        error: 'No valid Spotify token. Please authenticate first.',
        display: '♪ auth needed',
        needsAuth: true
      });
    }

    const fetch = (await import('node-fetch')).default;

    const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 204) {
      return res.json({
        isPlaying: false,
        display: '♪ not playing'
      });
    }

    if (response.status === 401) {
      return res.json({
        error: 'Spotify token expired',
        display: '♪ auth error'
      });
    }

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.item) {
      return res.json({
        isPlaying: false,
        display: '♪ not playing'
      });
    }

    const track = data.item;
    const artist = track.artists[0]?.name || 'Unknown Artist';
    const songTitle = track.name || 'Unknown Track';
    const isPlaying = data.is_playing;

    const fullDisplay = `♪ ${artist} - ${songTitle}`;
    const mobileDisplay = isPlaying ? formatForMobile(artist, songTitle) : '♪ paused';
    const desktopDisplay = isPlaying ? (fullDisplay.length > 50 ? fullDisplay.substring(0, 47) + '...' : fullDisplay) : '♪ paused';

    res.json({
      isPlaying,
      artist,
      track: songTitle,
      display: desktopDisplay,
      mobileDisplay: mobileDisplay,
      fullDisplay: fullDisplay,
      external_url: track.external_urls?.spotify
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Spotify API error:', error);
    } else {
      console.error('Spotify API error occurred');
    }

    res.json({
      error: 'API error',
      display: '♪ error'
    });
  }
});

app.get('/auth/spotify', (req, res) => {
  const scopes = 'user-read-currently-playing user-read-playback-state';
  const spotifyAuthUrl = 'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: SPOTIFY_CLIENT_ID,
      scope: scopes,
      redirect_uri: REDIRECT_URI,
    });

  res.redirect(spotifyAuthUrl);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Authorization code missing');
  }

  try {
    const fetch = (await import('node-fetch')).default;

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI
      })
    });

    const data = await response.json();

    if (data.access_token) {
      spotifyTokens.access_token = data.access_token;
      spotifyTokens.refresh_token = data.refresh_token;
      spotifyTokens.expires_at = Date.now() + (data.expires_in * 1000);
      saveTokens();

      console.log('Spotify authentication successful');
      console.log(`Token expires in ${Math.floor(data.expires_in / 3600)} hours`);

      res.send(`
        <html>
          <body style="font-family: 'JetBrains Mono', monospace; background: #0a0a0a; color: #ffffff; padding: 20px;">
            <h2>Spotify Authentication Successful!</h2>
            <p>Your Spotify integration is now active. The server will automatically refresh tokens as needed.</p>
            <p>Token expires in: ${Math.floor(data.expires_in / 3600)} hours</p>
            <p><a href="/" style="color: #d4765a;">← Back to site</a></p>
            <script>
              setTimeout(() => {
                window.location.href = '/';
              }, 3000);
            </script>
          </body>
        </html>
      `);
    } else {
      res.status(400).send('Failed to get access token: ' + JSON.stringify(data));
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Spotify auth error:', error);
    } else {
      console.error('Spotify authentication failed');
    }
    res.status(500).send('Authentication failed');
  }
});

app.get('/up', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    spotify: spotifyTokens.access_token ? 'authenticated' : 'not authenticated'
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Terminal site running on port ${PORT}`);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`Visit: http://localhost:${PORT}`);
  }

  if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
    console.log('Spotify Client ID configured');
    console.log('Spotify Client Secret configured');
    if (!spotifyTokens.access_token) {
      const baseUrl = process.env.NODE_ENV === 'production' 
        ? (process.env.BASE_URL || 'https://yourdomain.com')
        : `http://localhost:${PORT}`;
      console.log(`To enable Spotify: visit ${baseUrl}/auth/spotify`);
    }
  } else {
    console.log('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET');
  }
});