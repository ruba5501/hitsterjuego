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

const reproductorLocal = new Audio();
let spotifyPlayer = null;
let spotifyDeviceId = null;

// ELEMENTOS DOM
const btnSpotify = document.getElementById('btn-spotify');
const btnOffline = document.getElementById('btn-offline');
const btnRevelar = document.getElementById('btn-revelar');
const btnPasar = document.getElementById('btn-pasar');
const btnPausa = document.getElementById('btn-pausa');
const btnEmpezar = document.getElementById('btn-empezar');
const btnResolverTurno = document.getElementById('btn-resolver-turno');
const btnConfirmarActivo = document.getElementById('btn-confirmar-activo');
const btnCerrarSesion = document.getElementById('btn-cerrar-sesion');

const cartaSecreta = document.getElementById('carta-secreta');
const tituloCarta = document.getElementById('titulo-carta');
const artistaCarta = document.getElementById('artista-carta');
const anioCarta = document.getElementById('anio-carta');

const seccionLogin = document.getElementById('seccion-login');
const seccionInicio = document.getElementById('seccion-inicio');
const seccionJuego = document.getElementById('seccion-juego');
const indicadorTurno = document.getElementById('indicador-turno');
const spanCostoPasar = document.getElementById('costo-pasar');
const selectorPosicion = document.getElementById('selector-posicion');
const panelApuestasRivales = document.getElementById('panel-apuestas-rivales');
const contenedorBotonesRivales = document.getElementById('contenedor-botones-rivales');
const tableroEquipos = document.getElementById('tablero-equipos');
const apuestaEquipoActivo = document.getElementById('apuesta-equipo-activo');
const tituloFase = document.getElementById('titulo-fase');
const numEquiposInput = document.getElementById('num-equipos');
const contenedorEntradasEquipos = document.getElementById('contenedor-entradas-equipos');

// ESCUCHADORES DE EVENTOS
if (btnSpotify) btnSpotify.onclick = iniciarSesionSpotify;
if (btnOffline) btnOffline.onclick = iniciarJuegoOffline;
if (btnCerrarSesion) btnCerrarSesion.onclick = cerrarSesion;
if (numEquiposInput) numEquiposInput.oninput = generarFormularioEquipos;

btnPausa.onclick = alternarPausa;
btnPasar.onclick = pasarCancion;
btnConfirmarActivo.onclick = confirmarPosicionActiva;
btnRevelar.onclick = revelarRespuesta;
btnResolverTurno.onclick = resolverTurno;

function extraerPlaylistId(input) {
    if (!input) return null;
    const urlLimpia = input.trim();
    return urlLimpia.includes('/playlist/') ? urlLimpia.split('/playlist/')[1].split('?')[0] : urlLimpia;
}

function mostrarPantallaLogin() {
    if (btnCerrarSesion) btnCerrarSesion.style.display = 'none'; 
    seccionLogin.style.display = 'flex';
    seccionInicio.style.display = 'none';
    seccionJuego.style.display = 'none';
}

function iniciarJuegoOffline() {
    modoOffline = true;
    cancionesJuego = [...CANCIONES_LOCALES];
    seccionLogin.style.display = 'none';
    
    const contenedorPlaylist = document.getElementById('contenedor-playlist');
    if (contenedorPlaylist) contenedorPlaylist.style.display = 'none';

    seccionInicio.style.display = 'flex';
    generarFormularioEquipos();
}

function iniciarJuego() {
    modoOffline = false;
    if (btnCerrarSesion) btnCerrarSesion.style.display = 'block'; 
    seccionLogin.style.display = 'none';
    
    inicializarReproductorSpotify();

    const contenedorPlaylist = document.getElementById('contenedor-playlist');
    if (contenedorPlaylist) contenedorPlaylist.style.display = 'flex';

    seccionInicio.style.display = 'flex';
    generarFormularioEquipos();
}

function cerrarSesion() {
    localStorage.clear();
    const spotifyWindow = window.open('https://www.spotify.com/logout/', '_blank', 'width=700,height=500');
    setTimeout(() => {
        if (spotifyWindow) spotifyWindow.close();
        window.location.href = window.location.origin + window.location.pathname;
    }, 2000);
}

// REPRODUCTOR SPOTIFY
window.onSpotifyWebPlaybackSDKReady = () => {};

function inicializarReproductorSpotify() {
    if (!accessToken) return;

    spotifyPlayer = new Spotify.Player({
        name: 'Hitster Web Player',
        getOAuthToken: cb => cb(accessToken),
        volume: 0.8
    });

    spotifyPlayer.addListener('ready', ({ device_id }) => { spotifyDeviceId = device_id; });
    spotifyPlayer.addListener('player_state_changed', state => {
        if (state) btnPausa.textContent = state.paused ? "Reanudar" : "Pausar";
    });

    spotifyPlayer.connect();
}

async function reproducirCancion(cancion) {
    if (modoOffline) {
        reproductorLocal.src = cancion.audioUrl;
        reproductorLocal.play().catch(e => console.error("Error al reproducir audio local:", e));
    } else if (spotifyDeviceId && accessToken) {
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
    modoOffline ? reproductorLocal.pause() : spotifyPlayer?.pause();
}

function alternarPausa() {
    if (modoOffline) {
        reproductorLocal.paused ? reproductorLocal.play() : reproductorLocal.pause();
        btnPausa.textContent = reproductorLocal.paused ? "Reanudar" : "Pausar";
    } else {
        spotifyPlayer?.togglePlay();
    }
}

// AUTENTICACIÓN PKCE SPOTIFY
function generarCadenaAleatoria(longitud) {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const valoresAleatorios = new Uint8Array(longitud);
    window.crypto.getRandomValues(valoresAleatorios);
    return Array.from(valoresAleatorios, v => caracteres[v % caracteres.length]).join('');
}

async function generarCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
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
        `client_id=${CLIENT_ID}&response_type=code` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(SCOPES)}` +
        `&code_challenge_method=S256&code_challenge=${codeChallenge}&show_dialog=true`;
        
    window.location.href = urlLogin;
}

async function intercambiarCodigoPorToken(code) {
    const codeVerifier = localStorage.getItem('pkce_code_verifier');
    try {
        const respuesta = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID, grant_type: 'authorization_code',
                code, redirect_uri: REDIRECT_URI, code_verifier: codeVerifier
            })
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
    try {
        const respuesta = await fetch(`https://api.spotify.com/v1/playlists/${idPlaylist}/tracks?fields=items(track(name,uri,artists,album(release_date)))`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!respuesta.ok) throw new Error("Error obteniendo playlist");
        
        const datos = await respuesta.json();
        const cancionesFiltradas = datos.items
            .filter(item => item.track?.album?.release_date)
            .map(item => ({
                titulo: item.track.name,
                artista: item.track.artists[0].name,
                anio: parseInt(item.track.album.release_date.substring(0, 4)),
                spotifyUri: item.track.uri
            }));

        if (!cancionesFiltradas.length) {
            alert("La playlist no contiene canciones válidas.");
            return false;
        }

        cancionesJuego = cancionesFiltradas;
        return true;
    } catch (error) {
        alert(`Error de Spotify: ${error.message}`);
        return false;
    }
}

// FORMULARIO Y CONFIGURACIÓN
function generarFormularioEquipos() {
    const totalEquipos = parseInt(numEquiposInput.value) || 2;
    contenedorEntradasEquipos.innerHTML = '';

    for (let i = 1; i <= totalEquipos; i++) {
        const divEquipo = document.createElement('div');
        divEquipo.className = 'grupo-formulario';
        divEquipo.style.cssText = "background: #222; padding: 10px; border-radius: 5px;";
        divEquipo.innerHTML = `
            <strong style="color: var(--color-acento, #1db954);">Equipo ${i}</strong>
            <input type="text" id="nombre-equipo-${i}" value="Equipo ${i}" placeholder="Nombre del Equipo">
            <input type="number" id="anio-equipo-${i}" value="${1990 + (i * 5)}" placeholder="Año inicial">
        `;
        contenedorEntradasEquipos.appendChild(divEquipo);
    }
}

btnEmpezar.addEventListener('click', async () => {
    const totalEquipos = parseInt(numEquiposInput.value) || 2;

    if (!modoOffline) {
        const inputPlaylist = document.getElementById('url-playlist').value;
        const idExtraido = extraerPlaylistId(inputPlaylist);
        
        if (!idExtraido || !(await obtenerCancionesSpotify(idExtraido))) {
            alert("Verifica la URL o ID de la playlist.");
            return;
        }
    }

    equipos = Array.from({ length: totalEquipos }, (_, index) => {
        const i = index + 1;
        return {
            id: i,
            nombre: document.getElementById(`nombre-equipo-${i}`).value.trim() || `Equipo ${i}`,
            fichas: 5,
            lineaTiempo: [{
                titulo: "Año Inicial",
                artista: "Elección del equipo",
                anio: parseInt(document.getElementById(`anio-equipo-${i}`).value) || 2000
            }]
        };
    });

    seccionInicio.style.display = 'none';
    seccionJuego.style.display = 'flex';

    actualizarTableroVisual();
    nuevoTurno();
});

function modificarFichas(equipoId, cantidad) {
    const eq = equipos.find(e => e.id === equipoId);
    if (eq) {
        eq.fichas = Math.max(0, eq.fichas + cantidad);
        actualizarTableroVisual();
    }
}

function actualizarTableroVisual() {
    tableroEquipos.innerHTML = '';
    equipos.forEach((eq, index) => {
        const esTurnoActual = index === turnoActual;
        const contenedorEq = document.createElement('div');
        contenedorEq.style.cssText = `background: #1e1e1e; padding: 15px; border-radius: 10px; border: 2px solid ${esTurnoActual ? 'var(--color-acento, #1db954)' : '#333'}`;
        
        contenedorEq.innerHTML = `
            <div style="display:flex; justify-space-between; align-items:center; margin-bottom: 10px; font-weight:bold;">
                <span style="color: ${esTurnoActual ? 'var(--color-acento)' : 'white'}">${eq.nombre} ${esTurnoActual ? '(Jugando)' : ''}</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color: #e67e22;">🪙 Fichas: ${eq.fichas}</span>
                    <button onclick="modificarFichas(${eq.id}, 1)" style="padding:2px 8px; width:auto; background:#2ecc71; font-size:0.8rem;">+1</button>
                    <button onclick="modificarFichas(${eq.id}, -1)" style="padding:2px 8px; width:auto; background:#e74c3c; font-size:0.8rem;">-1</button>
                </div>
            </div>
            <div class="contenedor-linea-tiempo" id="tl-eq-${eq.id}"></div>
        `;
        
        tableroEquipos.appendChild(contenedorEq);
        const tlContenedor = document.getElementById(`tl-eq-${eq.id}`);
        
        eq.lineaTiempo.sort((a,b) => a.anio - b.anio).forEach(cancion => {
            const miniCarta = document.createElement('div');
            miniCarta.className = 'carta-linea-tiempo';
            
            if (!cancion.spotifyUri && !cancion.audioUrl) {
                miniCarta.innerHTML = `<div class="anio" style="font-size: 1.5rem; color: #fff; background: #2a2a2a; padding: 10px; width: 100%; border-radius: 6px;">${cancion.anio}</div>`;
            } else {
                miniCarta.innerHTML = `
                    <div style="color: var(--color-texto-secundario);">${cancion.artista}</div>
                    <div class="titulo" title="${cancion.titulo}">${cancion.titulo}</div>
                    <div class="anio">${cancion.anio}</div>
                `;
            }
            tlContenedor.appendChild(miniCarta);
        });
    });
}

function nuevoTurno() {
    if (!cancionesJuego.length) {
        alert("¡Se han acabado las canciones disponibles!");
        return;
    }

    apuestasRivales = {};
    posicionElegidaActivo = null;
    
    tituloFase.textContent = "Fase de Colocación";
    apuestaEquipoActivo.style.display = 'block';
    selectorPosicion.disabled = false;
    btnConfirmarActivo.style.display = 'block';
    
    panelApuestasRivales.style.display = 'none';
    btnResolverTurno.style.display = 'none';
    btnRevelar.style.display = 'none';
    btnPasar.style.display = 'block';
    btnPausa.style.display = 'block';
    btnPausa.textContent = "Pausar";
    cartaSecreta.classList.add('oculta');
    
    spanCostoPasar.textContent = costoPasarCancion;
    indicadorTurno.textContent = `Turno activo: ${equipos[turnoActual].nombre}`;
    
    cancionActual = cancionesJuego.splice(Math.floor(Math.random() * cancionesJuego.length), 1)[0];

    tituloCarta.textContent = cancionActual.titulo;
    artistaCarta.textContent = cancionActual.artista;
    anioCarta.textContent = cancionActual.anio;

    reproducirCancion(cancionActual);
    prepararSelectorEspacios();
    actualizarTableroVisual();
}

function prepararSelectorEspacios() {
    selectorPosicion.innerHTML = '';
    const lt = equipos[turnoActual].lineaTiempo.sort((a, b) => a.anio - b.anio);

    selectorPosicion.add(new Option(`Antes de ${lt[0].anio}`, "0"));
    for (let i = 0; i < lt.length - 1; i++) {
        selectorPosicion.add(new Option(`Entre ${lt[i].anio} y ${lt[i + 1].anio}`, `${i + 1}`));
    }
    if (lt.length >= 1) {
        selectorPosicion.add(new Option(`Después de ${lt[lt.length - 1].anio}`, `${lt.length}`));
    }
}

function pasarCancion() {
    const eq = equipos[turnoActual];
    if (eq.fichas < costoPasarCancion) return;
    eq.fichas -= costoPasarCancion++;
    pausarAudio();
    nuevoTurno();
}

function confirmarPosicionActiva() {
    posicionElegidaActivo = parseInt(selectorPosicion.value);
    selectorPosicion.disabled = true;
    btnConfirmarActivo.style.display = 'none';
    btnPasar.style.display = 'none';
    btnPausa.style.display = 'none';
    
    tituloFase.textContent = "Turno de Robo de los Rivales";
    contenedorBotonesRivales.innerHTML = '';

    equipos.forEach((eq, index) => {
        if (index !== turnoActual && eq.fichas > 0) {
            const divRival = document.createElement('div');
            divRival.style.cssText = "display:flex; gap:10px; align-items:center; background:#252525; padding:8px; border-radius:5px;";
            
            const selRival = document.createElement('select');
            Array.from(selectorPosicion.options).forEach(opt => {
                if (parseInt(opt.value) !== posicionElegidaActivo) {
                    selRival.appendChild(opt.cloneNode(true));
                }
            });

            const btnRobar = document.createElement('button');
            btnRobar.textContent = "Apostar Robo";
            btnRobar.style.cssText = "padding:5px 10px; font-size:0.8rem; width:auto; background:#ff0080; color:white;";
            
            btnRobar.onclick = () => {
                apuestasRivales[eq.id] = parseInt(selRival.value);
                btnRobar.textContent = "Fijado";
                btnRobar.style.background = "#555";
                btnRobar.disabled = selRival.disabled = true;
            };

            divRival.append(`${eq.nombre}: `, selRival, btnRobar);
            contenedorBotonesRivales.appendChild(divRival);
        }
    });

    panelApuestasRivales.style.display = 'block';
    btnRevelar.style.display = 'block';
}

function revelarRespuesta() {
    pausarAudio();
    cartaSecreta.classList.remove('oculta');
    btnRevelar.style.display = 'none';
    panelApuestasRivales.style.display = 'none';
    apuestaEquipoActivo.style.display = 'none';
    
    tituloFase.textContent = "Resultados del Turno";
    
    const eqActivo = equipos[turnoActual];
    let copiaLinea = [...eqActivo.lineaTiempo, cancionActual].sort((a,b) => a.anio - b.anio);
    const indiceCorrectoReal = copiaLinea.indexOf(cancionActual);
    
    let cartaEntregada = false;

    if (esPosicionCorrecta(posicionElegidaActivo, eqActivo.lineaTiempo, cancionActual, indiceCorrectoReal)) {
        eqActivo.lineaTiempo.push(cancionActual);
        eqActivo.lineaTiempo.sort((a, b) => a.anio - b.anio); 
        cartaEntregada = true; 
    }

    equipos.forEach(eq => {
        if (apuestasRivales[eq.id] !== undefined) {
            if (esPosicionCorrecta(apuestasRivales[eq.id], eqActivo.lineaTiempo, cancionActual, indiceCorrectoReal)) {
                if (!cartaEntregada) {
                    eq.lineaTiempo.push(cancionActual);
                    eq.lineaTiempo.sort((a, b) => a.anio - b.anio);
                    cartaEntregada = true; 
                }
            } else {
                eq.fichas--;
            }
        }
    });

    actualizarTableroVisual();
    btnResolverTurno.style.display = 'block';
}

function esPosicionCorrecta(opcionElegida, lineaDeTiempo, nuevaCancion, indiceReal) {
    if (opcionElegida === indiceReal) return true;
    const cIzq = lineaDeTiempo[opcionElegida - 1];
    const cDer = lineaDeTiempo[opcionElegida];
    return (cIzq && cIzq.anio === nuevaCancion.anio) || (cDer && cDer.anio === nuevaCancion.anio);
}

function resolverTurno() {
    const ganador = equipos.find(e => e.lineaTiempo.length >= 10);
    if (ganador) {
        alert(`¡Felicidades! ${ganador.nombre} ha ganado la partida.`);
        window.location.reload();
        return;
    }

    turnoActual = (turnoActual + 1) % equipos.length;
    costoPasarCancion = 1; 
    nuevoTurno();
}

verificarToken();