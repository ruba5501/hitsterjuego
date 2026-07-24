const CLIENT_ID = '401aa21001644430a51ac54c4198096b';
const REDIRECT_URI = window.location.origin + window.location.pathname; 
const SCOPES = 'streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative';

const CANCIONES_LOCALES = [
    { titulo: "Por la raja de tu falda", artista: "Estopa", anio: 1999, audioUrl: "audio/cancion.mp3" },
];

let playlistIdActual = '37i9dQZEVXbNFJfN13P3Xx';
let modoOffline = false;
let cancionesJuego = [];
let cancionActual = null;
let accessToken = null;
let equipos = [];
let turnoActual = 0;
let costoPasarCancion = 1;
let apuestasRivales = {}; 
let posicionElegidaActivo = null;

// Reproductor HTML5 para modo offline
const reproductorLocal = new Audio();

// Variables de reproducción Web Playback SDK (Spotify)
let spotifyPlayer = null;
let spotifyDeviceId = null;

// Elementos del DOM
const btnPlay = document.getElementById('btn-play');
const btnOffline = document.getElementById('btn-offline');
const btnReveal = document.getElementById('btn-reveal');
const btnSkip = document.getElementById('btn-skip');
const btnTogglePause = document.getElementById('btn-toggle-pause');
const btnStartGame = document.getElementById('btn-start-game');
const btnResolveTurn = document.getElementById('btn-resolve-turn');
const btnConfirmActive = document.getElementById('btn-confirm-active');
const secretCard = document.getElementById('secret-card');
const cardTitle = document.getElementById('card-title');
const cardArtist = document.getElementById('card-artist');
const cardYear = document.getElementById('card-year');
const btnLogout = document.getElementById('btn-logout');

const setupSection = document.getElementById('setup-section');
const gamePlaySection = document.getElementById('game-play-section');
const turnIndicator = document.getElementById('turn-indicator');
const skipCostSpan = document.getElementById('skip-cost');
const selectPlacement = document.getElementById('select-placement');
const rivalsBetPanel = document.getElementById('rivals-bet-panel');
const rivalsButtonsContainer = document.getElementById('rivals-buttons-container');
const teamsBoard = document.getElementById('teams-board');
const activeTeamBetDiv = document.getElementById('active-team-bet');
const phaseTitle = document.getElementById('phase-title');

// Event Listeners Principales
if (btnPlay) btnPlay.onclick = iniciarSesionSpotify;
if (btnOffline) btnOffline.onclick = iniciarJuegoOffline;

// Extrae el ID limpio tanto si se pega una URL completa como un ID directo
function extraerPlaylistId(input) {
    if (!input) return null;
    const urlLimpia = input.trim();
    if (urlLimpia.includes('/playlist/')) {
        const parteID = urlLimpia.split('/playlist/')[1];
        return parteID.split('?')[0];
    }
    return urlLimpia;
}

function mostrarPantallaLogin() {
    if (btnLogout) btnLogout.style.display = 'none'; 
    document.getElementById('player-section').style.display = 'flex';
    setupSection.style.display = 'none';
    gamePlaySection.style.display = 'none';
}

function iniciarJuegoOffline() {
    modoOffline = true;
    cancionesJuego = CANCIONES_LOCALES.map(c => ({ ...c }));
    
    document.getElementById('player-section').style.display = 'none';
    
    const playlistContainer = document.getElementById('playlist-input-container');
    if (playlistContainer) playlistContainer.style.display = 'none';

    setupSection.style.display = 'flex';
    generarFormularioEquipos();
}

function iniciarJuego() {
    modoOffline = false;
    if (btnLogout) btnLogout.style.display = 'block'; 
    document.getElementById('player-section').style.display = 'none';
    
    inicializarReproductorSpotify();

    const playlistContainer = document.getElementById('playlist-input-container');
    if (playlistContainer) playlistContainer.style.display = 'flex';

    setupSection.style.display = 'flex';
    generarFormularioEquipos();
}

function cerrarSesion() {
    localStorage.clear();
    
    const logoutUrl = 'https://www.spotify.com/logout/';
    const spotifyWindow = window.open(logoutUrl, '_blank', 'width=700,height=500');
    
    setTimeout(() => {
        if (spotifyWindow) spotifyWindow.close();
        window.location.href = window.location.origin + window.location.pathname;
    }, 2000);
}

// CONFIGURACIÓN DEL REPRODUCTOR WEB DE SPOTIFY (SDK)
window.onSpotifyWebPlaybackSDKReady = () => {};

function inicializarReproductorSpotify() {
    if (!accessToken) return;

    spotifyPlayer = new Spotify.Player({
        name: 'Hitster Web Player',
        getOAuthToken: cb => { cb(accessToken); },
        volume: 0.8
    });

    spotifyPlayer.addListener('ready', ({ device_id }) => {
        spotifyDeviceId = device_id;
    });

    spotifyPlayer.addListener('player_state_changed', state => {
        if (!state) return;
        btnTogglePause.textContent = state.paused ? "Reanudar" : "Pausar";
    });

    spotifyPlayer.connect();
}

async function reproducirCancion(cancion) {
    if (modoOffline) {
        reproductorLocal.src = cancion.audioUrl;
        reproductorLocal.play().catch(e => console.error("Error al reproducir audio local:", e));
    } else {
        if (!spotifyDeviceId || !accessToken) return;

        await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
            method: 'PUT',
            body: JSON.stringify({ uris: [cancion.spotifyUri] }),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            }
        });
    }
}

function pausarAudio() {
    if (modoOffline) {
        reproductorLocal.pause();
    } else if (spotifyPlayer) {
        spotifyPlayer.pause();
    }
}

function alternarPausa() {
    if (modoOffline) {
        if (reproductorLocal.paused) {
            reproductorLocal.play();
            btnTogglePause.textContent = "Pausar";
        } else {
            reproductorLocal.pause();
            btnTogglePause.textContent = "Reanudar";
        }
    } else if (spotifyPlayer) {
        spotifyPlayer.togglePlay();
    }
}

// AUTENTICACIÓN PKCE SPOTIFY
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

async function verificarToken() {
    const parametrosUrl = new URLSearchParams(window.location.search);
    const codigoRespuesta = parametrosUrl.get('code');

    if (codigoRespuesta) {
        window.history.replaceState({}, document.title, window.location.pathname);
        await intercambiarCodigoPorToken(codigoRespuesta);
        return;
    }

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
    localStorage.setItem('pkce_code_verifier', codeVerifier);

    const urlLogin = `https://accounts.spotify.com/authorize?` + 
        `client_id=${CLIENT_ID}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(SCOPES)}` +
        `&code_challenge_method=S256` +
        `&code_challenge=${codeChallenge}` +
        `&show_dialog=true`;
        
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
            body: cuerpo.toString()
        });

        if (!respuesta.ok) throw new Error("Error en autenticación");

        const datos = await respuesta.json();
        accessToken = datos.access_token;
        localStorage.setItem('spotify_token', accessToken);
        localStorage.setItem('token_expiry', Date.now() + (datos.expires_in * 1000));
        localStorage.removeItem('pkce_code_verifier');
        iniciarJuego();
    } catch (error) {
        console.error(error);
        mostrarPantallaLogin();
    }
}

async function obtenerCancionesSpotify(idPlaylist) {
    const url = `https://api.spotify.com/v1/playlists/${idPlaylist}/tracks?fields=items(track(name,uri,artists,album(release_date)))`;
    try {
        const respuesta = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!respuesta.ok) throw new Error("Error obteniendo playlist");
        
        const datos = await respuesta.json();
        const cancionesFiltradas = datos.items
            .filter(item => item.track && item.track.album && item.track.album.release_date)
            .map(item => ({
                titulo: item.track.name,
                artista: item.track.artists[0].name,
                anio: parseInt(item.track.album.release_date.substring(0, 4)),
                spotifyUri: item.track.uri
            }));

        if (cancionesFiltradas.length === 0) {
            alert("La playlist no contiene canciones válidas.");
            return false;
        }

        cancionesJuego = cancionesFiltradas;
        return true;

    } catch (error) {
        console.error("Error al cargar Spotify:", error);
        alert(`Error de Spotify: ${error.message}`);
        return false;
    }
}

// FORMULARIO Y LÓGICA DEL JUEGO
document.getElementById('num-teams').addEventListener('input', generarFormularioEquipos);

function generarFormularioEquipos() {
    const contenedor = document.getElementById('teams-input-container');
    const totalEquipos = parseInt(document.getElementById('num-teams').value) || 2;
    contenedor.innerHTML = '';

    for (let i = 1; i <= totalEquipos; i++) {
        const divEquipo = document.createElement('div');
        divEquipo.style.cssText = "display: flex; flex-direction: column; gap: 5px; background: #222; padding: 10px; border-radius: 5px;";
        divEquipo.innerHTML = `
            <strong style="color: var(--accent-color, #1db954);">Equipo ${i}</strong>
            <input type="text" id="name-team-${i}" value="Equipo ${i}" placeholder="Nombre del Equipo" style="padding: 8px; border-radius: 4px; border: 1px solid #444; background: #333; color: white;">
            <input type="number" id="year-team-${i}" value="${1990 + (i * 5)}" placeholder="Año de su primera canción" style="padding: 8px; border-radius: 4px; border: 1px solid #444; background: #333; color: white;">
        `;
        contenedor.appendChild(divEquipo);
    }
}

btnStartGame.addEventListener('click', async () => {
    const totalEquipos = parseInt(document.getElementById('num-teams').value) || 2;
    
    if (document.getElementById('teams-input-container').children.length === 0) {
        generarFormularioEquipos();
        return; 
    }

    if (!modoOffline) {
        const inputPlaylist = document.getElementById('playlist-url').value;
        const idExtraido = extraerPlaylistId(inputPlaylist);
        
        if (!idExtraido) {
            alert("Por favor, introduce una URL o ID de playlist válida.");
            return;
        }

        playlistIdActual = idExtraido;
        const exito = await obtenerCancionesSpotify(playlistIdActual);
        
        if (!exito) {
            alert("No se pudo cargar la playlist. Verifica que sea pública y que la URL sea correcta.");
            return;
        }
    }

    equipos = [];
    
    for(let i = 1; i <= totalEquipos; i++) {
        const nombreInput = document.getElementById(`name-team-${i}`).value.trim() || `Equipo ${i}`;
        const anioInput = parseInt(document.getElementById(`year-team-${i}`).value) || 2000;

        const cartaInicialPersonalizada = {
            titulo: "Año Inicial",
            artista: "Elección del equipo",
            anio: anioInput,
            spotifyUri: null,
            audioUrl: null
        };

        equipos.push({
            id: i,
            nombre: nombreInput,
            fichas: 5,
            lineaTiempo: [cartaInicialPersonalizada] 
        });
    }

    setupSection.style.display = 'none';
    gamePlaySection.style.display = 'flex';

    actualizarTableroVisual();
    nuevoTurno();
});

function modificarFichas(equipoId, cantidad) {
    const eq = equipos.find(e => e.id === equipoId);
    if (eq) {
        eq.fichas += cantidad;
        if (eq.fichas < 0) eq.fichas = 0;
        actualizarTableroVisual();
    }
}

function actualizarTableroVisual() {
    teamsBoard.innerHTML = '';
    equipos.forEach((eq, index) => {
        const contenedorEq = document.createElement('div');
        contenedorEq.style.cssText = `background: #1e1e1e; padding: 15px; border-radius: 10px; border: 2px solid ${index === turnoActual ? 'var(--accent-color, #1db954)' : '#333'}`;
        
        contenedorEq.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; font-weight:bold;">
                <span style="color: ${index === turnoActual ? 'var(--accent-color, #1db954)' : 'white'}">${eq.nombre} ${index === turnoActual ? '(Jugando)' : ''}</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color: #e67e22; margin-right:5px;">🪙 Fichas: <span id="fichas-val-${eq.id}">${eq.fichas}</span></span>
                    <button onclick="modificarFichas(${eq.id}, 1)" style="padding:2px 8px; width:auto; background:#2ecc71; font-size:0.8rem;">+1</button>
                    <button onclick="modificarFichas(${eq.id}, -1)" style="padding:2px 8px; width:auto; background:#e74c3c; font-size:0.8rem;">-1</button>
                </div>
            </div>
            <div class="timeline-container" id="tl-eq-${eq.id}"></div>
        `;
        
        teamsBoard.appendChild(contenedorEq);
        const tlContenedor = document.getElementById(`tl-eq-${eq.id}`);
        
        eq.lineaTiempo.sort((a,b) => a.anio - b.anio).forEach(cancion => {
            const miniCarta = document.createElement('div');
            miniCarta.classList.add('timeline-card');
            
            if (!cancion.spotifyUri && !cancion.audioUrl) {
                miniCarta.innerHTML = `
                    <div class="year" style="font-size: 1.8rem; font-weight: bold; color: #ffffff; background: #2a2a2a; padding: 15px 10px; border-radius: 6px; text-align: center; width: 100%; max-width: 100%; box-sizing: border-box; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); margin: 0 auto; display: block;">
                        ${cancion.anio}
                    </div>
                `;
            } else {
                miniCarta.innerHTML = `
                    <div class="artist">${cancion.artista}</div>
                    <div class="title" title="${cancion.titulo}">${cancion.titulo}</div>
                    <div class="year">${cancion.anio}</div>
                `;
            }
            tlContenedor.appendChild(miniCarta);
        });
    });
}

function nuevoTurno() {
    if (cancionesJuego.length === 0) {
        alert("¡Se han acabado las canciones disponibles!");
        return;
    }

    apuestasRivales = {};
    posicionElegidaActivo = null;
    
    phaseTitle.textContent = "Fase de Colocación";
    activeTeamBetDiv.style.display = 'block';
    selectPlacement.disabled = false;
    btnConfirmActive.style.display = 'block';
    
    rivalsBetPanel.style.display = 'none';
    btnResolveTurn.style.display = 'none';
    btnReveal.style.display = 'none';
    btnSkip.style.display = 'block';
    btnTogglePause.style.display = 'block';
    btnTogglePause.textContent = "Pausar";
    secretCard.classList.add('hidden');
    
    skipCostSpan.textContent = costoPasarCancion;
    turnIndicator.textContent = `Turno activo: ${equipos[turnoActual].nombre}`;
    
    const indiceAleatorio = Math.floor(Math.random() * cancionesJuego.length);
    cancionActual = cancionesJuego.splice(indiceAleatorio, 1)[0];

    cardTitle.textContent = cancionActual.titulo;
    cardArtist.textContent = cancionActual.artista;
    cardYear.textContent = cancionActual.anio;

    reproducirCancion(cancionActual);
    
    prepararSelectorEspacios();
    actualizarTableroVisual();
}

function prepararSelectorEspacios() {
    selectPlacement.innerHTML = '';
    
    const lt = equipos[turnoActual].lineaTiempo.sort((a, b) => a.anio - b.anio);
    
    if (lt.length === 0) return;

    if (lt.length === 1) {
        const opAntes = document.createElement('option');
        opAntes.value = "0";
        opAntes.textContent = `Antes de ${lt[0].anio}`;
        selectPlacement.appendChild(opAntes);

        const opDespues = document.createElement('option');
        opDespues.value = "1";
        opDespues.textContent = `Después de ${lt[0].anio}`;
        selectPlacement.appendChild(opDespues);
        return;
    }

    const opAntes = document.createElement('option');
    opAntes.value = "0";
    opAntes.textContent = `Antes de ${lt[0].anio}`;
    selectPlacement.appendChild(opAntes);

    for (let i = 0; i < lt.length - 1; i++) {
        const opEntre = document.createElement('option');
        opEntre.value = `${i + 1}`;
        opEntre.textContent = `Entre ${lt[i].anio} y ${lt[i + 1].anio}`;
        selectPlacement.appendChild(opEntre);
    }

    const opDespues = document.createElement('option');
    opDespues.value = `${lt.length}`;
    opDespues.textContent = `Después de ${lt[lt.length - 1].anio}`;
    selectPlacement.appendChild(opDespues);
}

// CONTROLADORES DE REPRODUCCIÓN
btnTogglePause.addEventListener('click', alternarPausa);

btnSkip.addEventListener('click', () => {
    const eq = equipos[turnoActual];
    if (eq.fichas < costoPasarCancion) return;
    eq.fichas -= costoPasarCancion;
    costoPasarCancion++; 
    pausarAudio();
    nuevoTurno();
});

btnConfirmActive.addEventListener('click', () => {
    posicionElegidaActivo = parseInt(selectPlacement.value);
    selectPlacement.disabled = true;
    btnConfirmActive.style.display = 'none';
    btnSkip.style.display = 'none';
    btnTogglePause.style.display = 'none';
    
    phaseTitle.textContent = "Turno de Robo de los Rivales";
    rivalsButtonsContainer.innerHTML = '';

    equipos.forEach((eq, index) => {
        if(index !== turnoActual && eq.fichas > 0) {
            const divRival = document.createElement('div');
            divRival.style.cssText = "display:flex; gap:10px; align-items:center; background:#252525; padding:8px; border-radius:5px; margin-bottom:5px;";
            
            const selRival = document.createElement('select');
            selRival.id = `select-rival-${eq.id}`;
            selRival.style.cssText = "padding:5px; background:#444; color:white; border:none; border-radius:3px; flex-grow:1;";
            
            Array.from(selectPlacement.options).forEach(opt => {
                if (parseInt(opt.value) !== posicionElegidaActivo) {
                    const clone = opt.cloneNode(true);
                    selRival.appendChild(clone);
                }
            });

            divRival.innerHTML = `<span style="font-size:0.9rem; min-width:80px;">${eq.nombre}:</span>`;
            
            const btnRobar = document.createElement('button');
            btnRobar.textContent = "Apostar Robo";
            btnRobar.style.cssText = "padding:5px 10px; font-size:0.8rem; width:auto; background:#ff0080; color:white; border:none; border-radius:3px;";
            
            btnRobar.onclick = () => {
                apuestasRivales[eq.id] = parseInt(selRival.value);
                btnRobar.textContent = "Fijado";
                btnRobar.style.background = "#555";
                btnRobar.disabled = true;
                selRival.disabled = true;
            };

            divRival.appendChild(selRival);
            divRival.appendChild(btnRobar);
            rivalsButtonsContainer.appendChild(divRival);
        }
    });

    rivalsBetPanel.style.display = 'block';
    btnReveal.style.display = 'block'; 
});

btnReveal.addEventListener('click', () => {
    pausarAudio();
    secretCard.classList.remove('hidden');
    btnReveal.style.display = 'none';
    rivalsBetPanel.style.display = 'none';
    activeTeamBetDiv.style.display = 'none';
    
    phaseTitle.textContent = "Resultados del Turno";
    
    const eqActivo = equipos[turnoActual];
    let copiaLinea = [...eqActivo.lineaTiempo];
    copiaLinea.push(cancionActual);
    copiaLinea.sort((a,b) => a.anio - b.anio);
    const indiceCorrectoReal = copiaLinea.indexOf(cancionActual);
    
    let activoHaAcertado = esPosicionCorrecta(posicionElegidaActivo, eqActivo.lineaTiempo, cancionActual, indiceCorrectoReal);
    let cartaEntregada = false;

    if (activoHaAcertado) {
        eqActivo.lineaTiempo.push(cancionActual);
        eqActivo.lineaTiempo.sort((a, b) => a.anio - b.anio); 
        cartaEntregada = true; 
    }

    equipos.forEach(eq => {
        if(apuestasRivales[eq.id] !== undefined) {
            let rivalHaAcertado = esPosicionCorrecta(apuestasRivales[eq.id], eqActivo.lineaTiempo, cancionActual, indiceCorrectoReal);
            
            if(rivalHaAcertado) {
                if (!cartaEntregada) {
                    eq.lineaTiempo.push(cancionActual);
                    eq.lineaTiempo.sort((a, b) => a.anio - b.anio);
                    cartaEntregada = true; 
                }
            } else {
                eq.fichas -= 1;
            }
        }
    });

    actualizarTableroVisual();
    btnResolveTurn.style.display = 'block';
});

function esPosicionCorrecta(opcionElegida, lineaDeTiempo, nuevaCancion, indiceReal) {
    if (opcionElegida === indiceReal) return true;

    const cartaIzquierda = lineaDeTiempo[opcionElegida - 1];
    const cartaDerecha = lineaDeTiempo[opcionElegida];
    
    if (cartaIzquierda && cartaIzquierda.anio === nuevaCancion.anio) return true;
    if (cartaDerecha && cartaDerecha.anio === nuevaCancion.anio) return true;
    
    return false;
}

btnResolveTurn.addEventListener('click', () => {
    const ganador = equipos.find(e => e.lineaTiempo.length >= 10);
    if(ganador) {
        alert(`¡Felicidades! ${ganador.nombre} ha ganado la partida.`);
        window.location.reload();
        return;
    }

    turnoActual = (turnoActual + 1) % equipos.length;
    costoPasarCancion = 1; 
    nuevoTurno();
});

if (btnLogout) {
    btnLogout.addEventListener('click', cerrarSesion);
}

verificarToken();