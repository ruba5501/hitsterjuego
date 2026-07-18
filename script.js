const CLIENT_ID = '401aa21001644430a51ac54c4198096b';
const PLAYLIST_ID = '37i9dQZF1DXcBWIGoNa3Xm';
const REDIRECT_URI = window.location.origin + window.location.pathname; 
const SCOPES = 'playlist-read-private playlist-read-collaborative';

let cancionesJuego = [];
let cancionActual = null;
let accessToken = null;
let equipos = [];
let turnoActual = 0;
let costoPasarCancion = 1;
let apuestasRivales = {}; 
let posicionElegidaActivo = null;

// Elementos del DOM
const btnPlay = document.getElementById('btn-play');
const btnReveal = document.getElementById('btn-reveal');
const btnSkip = document.getElementById('btn-skip');
const btnTogglePause = document.getElementById('btn-toggle-pause'); // Nuevo botón
const btnStartGame = document.getElementById('btn-start-game');
const btnResolveTurn = document.getElementById('btn-resolve-turn');
const btnConfirmActive = document.getElementById('btn-confirm-active');
const audioPlayer = document.getElementById('audio-player');
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

function mostrarPantallaLogin() {
    btnPlay.textContent = "Conectar con Spotify";
    btnPlay.onclick = iniciarSesionSpotify;
    if (btnLogout) btnLogout.style.display = 'none'; 
    setupSection.style.display = 'none';
    gamePlaySection.style.display = 'none';
}

function iniciarJuego() {
    if (btnLogout) btnLogout.style.display = 'block'; 
    btnPlay.style.display = 'none';
    setupSection.style.display = 'flex';
    generarFormularioEquipos();
    obtenerCancionesSpotify(); 
}

function cerrarSesion() {
    localStorage.removeItem('spotify_token');
    localStorage.removeItem('token_expiry');
    localStorage.removeItem('pkce_code_verifier');
    window.location.reload();
}

// HERRAMIENTAS CRIPTOGRÁFICAS PARA PKCE
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

// SISTEMA DE AUTENTICACIÓN
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

        if (!respuesta.ok) {
            const errorDatos = await respuesta.json();
            throw new Error(`Error: ${errorDatos.error}`);
        }

        const datos = await respuesta.json();
        accessToken = datos.access_token;
        localStorage.setItem('spotify_token', accessToken);
        localStorage.setItem('token_expiry', Date.now() + (datos.expires_in * 1000));
        localStorage.removeItem('pkce_code_verifier');
        iniciarJuego();
    } catch (error) {
        console.error(error);
        cargarCancionesRespaldo();
    }
}

// CONEXIÓN CON LA API DE SPOTIFY
async function obtenerCancionesSpotify() {
    const url = `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/tracks?fields=items(track(name,artists,album(release_date),preview_url))`;
    try {
        const respuesta = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (respuesta.status === 403) {
            cargarCancionesRespaldo();
            return;
        }
        if (!respuesta.ok) throw new Error("Error");
        const datos = await respuesta.json();
        cancionesJuego = datos.items
            .map(item => ({
                titulo: item.track.name,
                artista: item.track.artists[0].name,
                anio: parseInt(item.track.album.release_date.substring(0, 4)),
                audioUrl: item.track.preview_url
            }))
            .filter(cancion => cancion.audioUrl !== null);

        if (cancionesJuego.length === 0) cargarCancionesRespaldo();
    } catch (error) {
        cargarCancionesRespaldo();
    }
}

// Generar campos de formulario dinámicamente cuando cambie el número de equipos
document.getElementById('num-teams').addEventListener('input', generarFormularioEquipos);

function generarFormularioEquipos() {
    const contenedor = document.getElementById('teams-input-container');
    const totalEquipos = parseInt(document.getElementById('num-teams').value) || 2;
    contenedor.innerHTML = '';

    for (let i = 1; i <= totalEquipos; i++) {
        const divEquipo = document.createElement('div');
        divEquipo.style.cssText = "display: flex; flex-direction: column; gap: 5px; background: #222; padding: 10px; border-radius: 5px;";
        divEquipo.innerHTML = `
            <strong style="color: var(--accent-color);">Equipo ${i}</strong>
            <input type="text" id="name-team-${i}" value="Equipo ${i}" placeholder="Nombre del Equipo" style="padding: 8px; border-radius: 4px; border: 1px solid #444; background: #333; color: white;">
            <input type="number" id="year-team-${i}" value="${1990 + (i * 5)}" placeholder="Año de su primera canción" style="padding: 8px; border-radius: 4px; border: 1px solid #444; background: #333; color: white;">
        `;
        contenedor.appendChild(divEquipo);
    }
}

btnStartGame.addEventListener('click', () => {
    const totalEquipos = parseInt(document.getElementById('num-teams').value) || 2;
    
    if (document.getElementById('teams-input-container').children.length === 0) {
        generarFormularioEquipos();
        return; 
    }

    equipos = [];
    
    for(let i = 1; i <= totalEquipos; i++) {
        const nombreInput = document.getElementById(`name-team-${i}`).value.trim() || `Equipo ${i}`;
        const anioInput = parseInt(document.getElementById(`year-team-${i}`).value) || 2000;

        const cartaInicialPersonalizada = {
            titulo: "Año Inicial",
            artista: "Elección del equipo",
            anio: anioInput,
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
        contenedorEq.style.cssText = `background: #1e1e1e; padding: 15px; border-radius: 10px; border: 2px solid ${index === turnoActual ? 'var(--accent-color)' : '#333'}`;
        
        contenedorEq.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; font-weight:bold;">
                <span style="color: ${index === turnoActual ? 'var(--accent-color)' : 'white'}">${eq.nombre} ${index === turnoActual ? '(Jugando)' : ''}</span>
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
            
            if (cancion.audioUrl === null) {
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
    btnTogglePause.textContent = "⏸️ Pausar"; // Resetear texto del botón de pausa
    secretCard.classList.add('hidden');
    
    skipCostSpan.textContent = costoPasarCancion;
    turnIndicator.textContent = `Turno activo: ${equipos[turnoActual].nombre}`;
    
    const indiceAleatorio = Math.floor(Math.random() * cancionesJuego.length);
    cancionActual = cancionesJuego.splice(indiceAleatorio, 1)[0];

    cardTitle.textContent = cancionActual.titulo;
    cardArtist.textContent = cancionActual.artista;
    cardYear.textContent = cancionActual.anio;

    audioPlayer.src = cancionActual.audioUrl;
    audioPlayer.play().catch(() => console.log("Reproducción automática pausada"));
    
    prepararSelectorEspacios();
    actualizarTableroVisual();
}

function prepararSelectorEspacios() {
    selectPlacement.innerHTML = '';
    const lt = equipos[turnoActual].lineaTiempo;
    
    const opAntes = document.createElement('option');
    opAntes.value = "0";
    opAntes.textContent = `Antes de ${lt[0].anio}`;
    selectPlacement.appendChild(opAntes);

    for(let i = 0; i < lt.length - 1; i++) {
        const opEntre = document.createElement('option');
        opEntre.value = `${i + 1}`;
        opEntre.textContent = `Entre ${lt[i].anio} y ${lt[i+1].anio}`;
        selectPlacement.appendChild(opEntre);
    }

    if(lt.length > 0) {
        const opDespues = document.createElement('option');
        opDespues.value = `${lt.length}`;
        opDespues.textContent = `Después de ${lt[lt.length-1].anio}`;
        selectPlacement.appendChild(opDespues);
    }
}

// CONTROLADOR DE PAUSA / REANUDACIÓN
btnTogglePause.addEventListener('click', () => {
    if (audioPlayer.paused) {
        audioPlayer.play().catch(() => console.log("Error al reanudar"));
        btnTogglePause.textContent = "⏸️ Pausar";
    } else {
        audioPlayer.pause();
        btnTogglePause.textContent = "▶️ Reanudar";
    }
});

// CONTROLADORES DE ACCIONES Y APUESTAS 
btnSkip.addEventListener('click', () => {
    const eq = equipos[turnoActual];
    if (eq.fichas < costoPasarCancion) {
        return;
    }
    eq.fichas -= costoPasarCancion;
    costoPasarCancion++; 
    audioPlayer.pause();
    nuevoTurno();
});

btnConfirmActive.addEventListener('click', () => {
    posicionElegidaActivo = parseInt(selectPlacement.value);
    selectPlacement.disabled = true;
    btnConfirmActive.style.display = 'none';
    btnSkip.style.display = 'none';
    btnTogglePause.style.display = 'none'; // Ocultar control de audio durante apuestas rivales
    
    phaseTitle.textContent = "Turno de Robo de los Rivales";
    
    rivalsButtonsContainer.innerHTML = '';
    let algunRivalConFichas = false;

    equipos.forEach((eq, index) => {
        if(index !== turnoActual && eq.fichas > 0) {
            algunRivalConFichas = true;
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
    audioPlayer.pause();
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

function cargarCancionesRespaldo() {
    cancionesJuego = [
        { titulo: "Macarena", artista: "Los Del Río", anio: 1993, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
        { titulo: "Corazón Partío", artista: "Alejandro Sanz", anio: 1997, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
        { titulo: "Wannabe", artista: "Spice Girls", anio: 1996, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
        { titulo: "La Flaca", artista: "Jarabe de Palo", anio: 1996, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" },
        { titulo: "Cuéntame al oído", artista: "La Oreja de Van Gogh", anio: 1998, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" },
        { titulo: "19 días y 500 noches", artista: "Joaquín Sabina", anio: 1999, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" },
        { titulo: "Vuela Vuela", artista: "Magneto", anio: 1991, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3" },
        { titulo: "Mi Tierra", artista: "Gloria Estefan", anio: 1993, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3" },
        { titulo: "Ciega, Sordomuda", artista: "Shakira", anio: 1998, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3" },
        { titulo: "All That She Wants", artista: "Ace of Base", anio: 1992, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3" },
        { titulo: "Aserejé", artista: "Las Ketchup", anio: 2002, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3" },
        { titulo: "Ave María", artista: "David Bisbal", anio: 2002, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3" },
        { titulo: "Zapatillas", artista: "El Canto del Loco", anio: 2005, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3" },
        { titulo: "Caminando por la vida", artista: "Melendi", anio: 2005, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3" },
        { titulo: "Gasolina", artista: "Daddy Yankee", anio: 2004, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3" },
        { titulo: "Hips Don't Lie", artista: "Shakira", anio: 2005, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3" },
        { titulo: "Malo", artista: "Bebe", anio: 2004, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
        { titulo: "Por la boca vive el pez", artista: "Fito & Fitipaldis", anio: 2006, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
        { titulo: "Papito", artista: "Miguel Bosé", anio: 2007, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
        { titulo: "Labios Compartidos", artista: "Maná", anio: 2006, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" },
        { titulo: "Colgando en tus manos", artista: "Carlos Baute y Marta Sánchez", anio: 2008, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" },
        { titulo: "Es por ti", artista: "Juanes", anio: 2002, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" },
        { titulo: "Bad Romance", artista: "Lady Gaga", anio: 2009, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3" },
        { titulo: "Waka Waka (Esto es África)", artista: "Shakira", anio: 2010, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3" },
        { titulo: "Danza Kuduro", artista: "Don Omar", anio: 2010, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3" },
        { titulo: "Bailando", artista: "Enrique Iglesias", anio: 2014, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3" },
        { titulo: "Despacito", artista: "Luis Fonsi ft. Daddy Yankee", anio: 2017, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3" },
        { titulo: "Malamente", artista: "Rosalía", anio: 2018, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3" },
        { titulo: "Lo Malo", artista: "Aitana y Ana Guerra", anio: 2018, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3" },
        { titulo: "La Bicicleta", artista: "Carlos Vives y Shakira", anio: 2016, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3" },
        { titulo: "Sofía", artista: "Alvaro Soler", anio: 2016, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3" },
        { titulo: "Shape of You", artista: "Ed Sheeran", anio: 2017, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3" },
        { titulo: "Mi Gente", artista: "J Balvin", anio: 2017, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
        { titulo: "Con Altura", artista: "Rosalía ft. J Balvin", anio: 2019, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
        { titulo: "Tusa", artista: "KAROL G ft. Nicki Minaj", anio: 2019, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
        { titulo: "Alocao", artista: "Omar Montes ft. Bad Gyal", anio: 2019, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" },
        { titulo: "Hawái", artista: "Maluma", anio: 2020, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" },
        { titulo: "Todo De Ti", artista: "Rauw Alejandro", anio: 2021, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" },
        { titulo: "Tacones Rojos", artista: "Sebastian Yatra", anio: 2021, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3" },
        { titulo: "Despechá", artista: "Rosalía", anio: 2022, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3" },
        { titulo: "Quevedo: Bzrp Music Sessions, Vol. 52", artista: "Bizarrap ft. Quevedo", anio: 2022, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3" },
        { titulo: "Shakira: Bzrp Music Sessions, Vol. 53", artista: "Bizarrap ft. Shakira", anio: 2023, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3" },
        { titulo: "Nochentera", artista: "Vicco", anio: 2023, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3" },
        { titulo: "Lala", artista: "Myke Towers", anio: 2023, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3" },
        { titulo: "Columbia", artista: "Quevedo", anio: 2023, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3" },
        { titulo: "Zorra", artista: "Nebulossa", anio: 2024, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3" },
        { titulo: "Si Antes Te Hubiera Conocido", artista: "KAROL G", anio: 2024, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3" },
        { titulo: "Gata Only", artista: "FloyyMenor ft. Cris Mj", anio: 2024, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3" },
        { titulo: "Potra Salvaje (Remix)", artista: "Isabel Aaiún ft. Fernando Moreno", anio: 2024, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
        { titulo: "Espresso", artista: "Sabrina Carpenter", anio: 2024, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
        { titulo: "Die With A Smile", artista: "Bruno Mars & Lady Gaga", anio: 2024, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
        { titulo: "Chulo pt.2", artista: "Bad Gyal, Tokischa, Young Miko", anio: 2023, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" },
        { titulo: "Monotonía", artista: "Shakira ft. Ozuna", anio: 2022, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" },
        { titulo: "La Bachata", artista: "Manuel Turizo", anio: 2022, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" },
        { titulo: "Baby Hello", artista: "Rauw Alejandro ft. Bizarrap", anio: 2023, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3" }, // Corregido dAnio por anio
        { titulo: "Solamente Tú", artista: "Pablo Alborán", anio: 2010, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3" },
        { titulo: "Ateo", artista: "C. Tangana ft. Nathy Peluso", anio: 2021, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3" },
        { titulo: "Tu Foto", artista: "Ozuna", anio: 2017, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3" }
    ];
}

verificarToken();