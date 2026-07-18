// ==========================================================================
// 1. CONFIGURACIÓN Y VARIABLES DE ESTADO
// ==========================================================================
const CLIENT_ID = '401aa21001644430a51ac54c4198096b'; // ID de cliente compartido
const PLAYLIST_ID = '37i9dQZF1DXcBWIGoNa3Xm'; // Playlist por defecto (Éxitos España)
const REDIRECT_URI = window.location.origin + window.location.pathname; 
const SCOPES = 'playlist-read-private playlist-read-collaborative';

let cancionesJuego = [];
let cancionesColocadas = []; // Almacenará los objetos de las canciones en la línea temporal
let cancionActual = null;
let fichasApostar = 5; 
let accessToken = null;

// Elementos del DOM
const btnPlay = document.getElementById('btn-play');
const btnReveal = document.getElementById('btn-reveal');
const audioPlayer = document.getElementById('audio-player');
const secretCard = document.getElementById('secret-card');
const cardTitle = document.getElementById('card-title');
const cardArtist = document.getElementById('card-artist');
const cardYear = document.getElementById('card-year');
const timeline = document.getElementById('timeline');

// ==========================================================================
// 2. HERRAMIENTAS CRIPTOGRÁFICAS PARA PKCE
// ==========================================================================
function generarCadenaAleatoria(longitud) {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let resultado = '';
    const valoresAleatorios = new Uint8Array(longitud);
    window.crypto.getRandomValues(valoresAleatorios);
    for (let i = 0; i < longitud; i++) {
        resultado += caracteres[valoresAleatorios[i] % caracteres.length];
    }
    return resultado;
}

async function generarCodeChallenge(codeVerifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ==========================================================================
// 3. SISTEMA DE AUTENTICACIÓN (PKCE COMPLETADO)
// ==========================================================================
async function verificarToken() {
    const parametrosUrl = new URLSearchParams(window.location.search);
    const codigoRespuesta = parametrosUrl.get('code');

    if (codigoRespuesta) {
        // Limpiamos la URL inmediatamente para evitar ejecuciones duplicadas
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Intercambiamos el código por el Token de acceso real
        await intercambiarCodigoPorToken(codigoRespuesta);
        return;
    }

    // Si no hay código en la URL, comprobamos el almacenamiento local
    const tokenGuardado = localStorage.getItem('spotify_token');
    const expiracion = localStorage.getItem('token_expiry');
    
    if (tokenGuardado && expiracion && Date.now() < expiracion) {
        accessToken = tokenGuardado;
        iniciarJuego();
    } else {
        mostrarPantallaLogin();
    }
}

async function iniciarSesionSpotify() {
    const codeVerifier = generarCadenaAleatoria(64);
    const codeChallenge = await generarCodeChallenge(codeVerifier);
    
    // Guardamos el verifier temporalmente para usarlo tras la redirección
    localStorage.setItem('pkce_code_verifier', codeVerifier);

    const urlLogin = `https://accounts.spotify.com/authorize?` + 
        `client_id=${CLIENT_ID}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(SCOPES)}` +
        `&code_challenge_method=S256` +
        `&code_challenge=${codeChallenge}`;
        
    window.location.href = urlLogin;
}

async function intercambiarCodigoPorToken(code) {
    const codeVerifier = localStorage.getItem('pkce_code_verifier');
    const url = 'https://accounts.spotify.com/api/token';

    const cuerpo = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier
    });

    try {
        const respuesta = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: cuerpo
        });

        if (!respuesta.ok) throw new Error("Error en el intercambio de tokens");

        const datos = await respuesta.json();
        
        accessToken = datos.access_token;
        localStorage.setItem('spotify_token', accessToken);
        localStorage.setItem('token_expiry', Date.now() + (datos.expires_in * 1000));
        localStorage.removeItem('pkce_code_verifier'); // Limpieza
        
        iniciarJuego();
    } catch (error) {
        console.error("Fallo al intercambiar el código PKCE:", error);
        alert("Error de autenticación. Cargando lista de respaldo.");
        cargarCancionesRespaldo();
    }
}

function mostrarPantallaLogin() {
    btnPlay.textContent = "🟢 Conectar con Spotify";
    btnPlay.onclick = iniciarSesionSpotify;
    
    document.getElementById('card-section').style.display = 'none';
    document.getElementById('timeline-section').style.display = 'none';
}

function iniciarJuego() {
    btnPlay.textContent = "▶️ Escuchar Canción";
    btnPlay.onclick = null; 
    
    document.getElementById('card-section').style.display = 'flex';
    document.getElementById('timeline-section').style.display = 'block';
    
    obtenerCancionesSpotify(); 
}

// ==========================================================================
// 4. CONEXIÓN CON LA API DE SPOTIFY
// ==========================================================================
async function obtenerCancionesSpotify() {
    const url = `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/tracks?fields=items(track(name,artists,album(release_date),preview_url))`;
    
    try {
        const respuesta = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (!respuesta.ok) throw new Error("Error al conectar con Spotify.");
        
        const datos = await respuesta.json();
        
        cancionesJuego = datos.items
            .map(item => ({
                titulo: item.track.name,
                artista: item.track.artists[0].name,
                anio: parseInt(item.track.album.release_date.substring(0, 4)),
                audioUrl: item.track.preview_url
            }))
            .filter(cancion => cancion.audioUrl !== null);

        console.log(`Cargadas ${cancionesJuego.length} canciones.`);
        siguienteCancion();
        
    } catch (error) {
        console.error(error);
        alert("Fallo al conectar con Spotify. Cargando lista de respaldo.");
        cargarCancionesRespaldo();
    }
}

// ==========================================================================
// 5. LÓGICA DEL JUEGO
// ==========================================================================
function siguienteCancion() {
    if (cancionesJuego.length === 0) {
        alert("¡Te has quedado sin canciones!");
        return;
    }

    const indiceAleatorio = Math.floor(Math.random() * cancionesJuego.length);
    cancionActual = cancionesJuego.splice(indiceAleatorio, 1)[0];

    secretCard.classList.add('hidden');
    cardTitle.textContent = cancionActual.titulo;
    cardArtist.textContent = cancionActual.artista;
    cardYear.textContent = cancionActual.anio;

    audioPlayer.src = cancionActual.audioUrl;
    btnPlay.textContent = "▶️ Escuchar Canción";
}

function colocarEnLineaDelTiempo() {
    cancionesColocadas.push(cancionActual);
    cancionesColocadas.sort((a, b) => a.anio - b.anio);

    timeline.innerHTML = '';

    cancionesColocadas.forEach(cancion => {
        const miniCarta = document.createElement('div');
        miniCarta.classList.add('timeline-card');
        miniCarta.innerHTML = `
            <div class="title" title="${cancion.titulo}">${cancion.titulo}</div>
            <div class="year">${cancion.anio}</div>
        `;
        timeline.appendChild(miniCarta);
    });
    
    setTimeout(siguienteCancion, 1500);
}

// ==========================================================================
// 6. EVENTOS DE LOS BOTONES
// ==========================================================================
btnPlay.addEventListener('click', () => {
    if (btnPlay.onclick !== null) return;

    if (audioPlayer.paused) {
        audioPlayer.play();
        btnPlay.textContent = "⏸️ Pausar";
    } else {
        audioPlayer.pause();
        btnPlay.textContent = "▶️ Escuchar Canción";
    }
});

btnReveal.addEventListener('click', () => {
    if (secretCard.classList.contains('hidden')) {
        secretCard.classList.remove('hidden');
        btnReveal.textContent = "⏭️ Siguiente Canción (Aceptar Año)";
        audioPlayer.pause();
        btnPlay.textContent = "▶️ Escuchar Canción";
    } else {
        colocarEnLineaDelTiempo();
        btnReveal.textContent = "👁️ Revelar Respuesta";
    }
});

function cargarCancionesRespaldo() {
    cancionesJuego = [
        { titulo: "Bohemian Rhapsody", artista: "Queen", anio: 1975, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
        { titulo: "Thriller", artista: "Michael Jackson", anio: 1982, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
        { titulo: "Smooth", artista: "Santana", anio: 1999, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" }
    ];
    siguienteCancion();
}

// ÚNICO PUNTO DE ENTRADA
verificarToken();