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

let lastTrackInfo = {
  artist: null,
  track: null,
  lastUpdated: null,
  external_url: null
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

function formatDisplays(artist, track, status = '') {
  const suffix = status ? ` (${status})` : '';
  const fullDisplay = `♪ ${artist} - ${track}${suffix}`;
  const mobileDisplay = formatForMobile(artist, track + suffix);
  const desktopDisplay = fullDisplay.length > 50 ? fullDisplay.substring(0, 47) + '...' : fullDisplay;
  
  return {
    fullDisplay,
    mobileDisplay,
    desktopDisplay,
    external_url: `https://open.spotify.com/search/${encodeURIComponent(artist + ' ' + track)}`
  };
}

function createTrackResponse(isPlaying, artist, track, status = '', externalUrl = null) {
  const displays = formatDisplays(artist, track);
  return {
    isPlaying,
    artist,
    track,
    display: displays.desktopDisplay,
    mobileDisplay: displays.mobileDisplay,
    fullDisplay: displays.fullDisplay,
    external_url: externalUrl || displays.external_url
  };
}

function handleNoTrackResponse() {
  if (lastTrackInfo.artist && lastTrackInfo.track) {
    return createTrackResponse(false, lastTrackInfo.artist, lastTrackInfo.track, '', lastTrackInfo.external_url);
  }
  return { isPlaying: false, display: '♪ not playing' };
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

loadTokens();

// Request logging middleware
app.use((req, res, next) => {
  // Skip logging for /up health check endpoint
  if (req.url === '/up') {
    return next();
  }
  
  const start = Date.now();
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  const userAgent = req.get('User-Agent') || '-';
  
  // Get real client IP through proxy headers
  const ip = req.get('CF-Connecting-IP') ||           // Cloudflare
            req.get('X-Forwarded-For')?.split(',')[0]?.trim() ||  // Load balancer/proxy
            req.get('X-Real-IP') ||                   // Nginx proxy
            req.get('X-Client-IP') ||                 // Apache
            req.get('X-Forwarded') ||                 // General proxy
            req.get('Forwarded') ||                   // RFC 7239
            req.connection?.remoteAddress ||          // Direct connection
            req.socket?.remoteAddress ||              // Socket connection
            req.ip ||                                 // Express default
            '-';
  
  const referer = req.get('Referer') || '-';

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const contentLength = res.get('Content-Length') || '-';
    
    // Nginx-style access log format
    console.log(`${ip} - - [${timestamp}] "${method} ${url} HTTP/1.1" ${status} ${contentLength} "${referer}" "${userAgent}" ${duration}ms`);
  });

  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

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
    
    // First, try to get currently playing track
    const currentResponse = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (currentResponse.status === 401) {
      return res.json({
        error: 'Spotify token expired',
        display: '♪ auth error'
      });
    }

    // If we have a currently playing track, use it
    if (currentResponse.ok && currentResponse.status !== 204) {
      const currentData = await currentResponse.json();
      
      if (currentData && currentData.item) {
        const track = currentData.item;
        const artist = track.artists[0]?.name || 'Unknown Artist';
        const songTitle = track.name || 'Unknown Track';
        
        lastTrackInfo.artist = artist;
        lastTrackInfo.track = songTitle;
        lastTrackInfo.external_url = track.external_urls?.spotify;
        lastTrackInfo.lastUpdated = Date.now();
        
        return res.json(createTrackResponse(true, artist, songTitle, '', track.external_urls?.spotify));
      }
    }

    // Fallback to recently played if no current track
    const recentResponse = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!recentResponse.ok) {
      throw new Error(`Spotify API error: ${recentResponse.status}`);
    }

    const recentData = await recentResponse.json();

    if (recentData.items && recentData.items.length > 0) {
      const recentTrack = recentData.items[0].track;
      const artist = recentTrack.artists[0]?.name || 'Unknown Artist';
      const songTitle = recentTrack.name || 'Unknown Track';
      
      lastTrackInfo.artist = artist;
      lastTrackInfo.track = songTitle;
      lastTrackInfo.external_url = recentTrack.external_urls?.spotify;
      lastTrackInfo.lastUpdated = Date.now();
      
      return res.json(createTrackResponse(true, artist, songTitle, '', recentTrack.external_urls?.spotify));
    }

    return res.json(handleNoTrackResponse());

  } catch (error) {
    console.error(process.env.NODE_ENV !== 'production' ? 'Spotify API error:' : 'Spotify API error occurred', error);
    res.json({
      error: 'API error',
      display: '♪ error'
    });
  }
});

app.get('/api/spotify/recent-tracks', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();

    if (!accessToken) {
      return res.json({
        error: 'No valid Spotify token. Please authenticate first.'
      });
    }

    const fetch = (await import('node-fetch')).default;
    const limit = req.query.limit || 5;

    const response = await fetch(`https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      return res.json({
        error: 'Spotify token expired'
      });
    }

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }

    const data = await response.json();

    const tracks = data.items.map((item, index) => ({
      rank: index + 1,
      name: item.track.name,
      artist: item.track.artists.map(artist => artist.name).join(', '),
      album: item.track.album.name,
      duration_ms: item.track.duration_ms,
      external_url: item.track.external_urls?.spotify,
      played_at: item.played_at
    }));

    res.json({
      total: data.total,
      tracks
    });

  } catch (error) {
    console.error(process.env.NODE_ENV !== 'production' ? 'Spotify recent tracks error:' : 'Spotify API error occurred', error);
    res.json({
      error: 'Failed to fetch recent tracks'
    });
  }
});

app.get('/api/spotify/top-artists', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();

    if (!accessToken) {
      return res.json({
        error: 'No valid Spotify token. Please authenticate first.'
      });
    }

    const fetch = (await import('node-fetch')).default;
    const timeRange = req.query.time_range || 'medium_term'; // short_term, medium_term, long_term
    const limit = req.query.limit || 10;

    const response = await fetch(`https://api.spotify.com/v1/me/top/artists?time_range=${timeRange}&limit=${limit}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      return res.json({
        error: 'Spotify token expired'
      });
    }

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }

    const data = await response.json();

    const artists = data.items.map((artist, index) => ({
      rank: index + 1,
      name: artist.name,
      genres: artist.genres.join(', '),
      popularity: artist.popularity,
      followers: artist.followers.total,
      external_url: artist.external_urls?.spotify
    }));

    res.json({
      time_range: timeRange,
      total: data.total,
      artists
    });

  } catch (error) {
    console.error(process.env.NODE_ENV !== 'production' ? 'Spotify top artists error:' : 'Spotify API error occurred', error);
    res.json({
      error: 'Failed to fetch top artists'
    });
  }
});

app.get('/auth/spotify', (req, res) => {
  const scopes = 'user-read-recently-played user-read-currently-playing user-read-playback-state user-top-read';
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
    console.error(process.env.NODE_ENV !== 'production' ? 'Spotify auth error:' : 'Spotify authentication failed', error);
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

app.post('/api/log/command', (req, res) => {
  const { command } = req.body;
  const timestamp = new Date().toISOString();
  const ip = req.get('CF-Connecting-IP') ||
            req.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
            req.get('X-Real-IP') ||
            req.get('X-Client-IP') ||
            req.connection?.remoteAddress ||
            req.ip || '-';
  const userAgent = req.get('User-Agent') || '-';
  
  // Log terminal command execution
  console.log(`[TERMINAL] ${ip} [${timestamp}] executed: "${command}" "${userAgent}"`);
  
  res.status(200).json({ logged: true });
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