// ==========================================================================
// 1. CONFIGURACIÓN Y VARIABLES DE ESTADO
// ==========================================================================
const CLIENT_ID = '401aa21001644430a51ac54c4198096b';
const PLAYLIST_ID = '37i9dQZF1DXcBWIGoNa3Xm';
const REDIRECT_URI = window.location.origin + window.location.pathname; 
const SCOPES = 'playlist-read-private playlist-read-collaborative';

let cancionesJuego = [];
let cancionActual = null;
let accessToken = null;

// LÓGICA MULTIEQUIPO Y APUESTAS
let equipos = [];
let turnoActual = 0;
let costoPasarCancion = 1;
let apuestasRivales = {}; // Guarda qué rivales apuestan en contra

// Elementos del DOM
const btnPlay = document.getElementById('btn-play');
const btnReveal = document.getElementById('btn-reveal');
const btnSkip = document.getElementById('btn-skip');
const btnStartGame = document.getElementById('btn-start-game');
const btnResolveTurn = document.getElementById('btn-resolve-turn');
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

function mostrarPantallaLogin() {
    btnPlay.textContent = "Conectar con Spotify";
    btnPlay.onclick = iniciarSesionSpotify;
    if (btnLogout) btnLogout.style.display = 'none'; 
    setupSection.style.display = 'none';
    gamePlaySection.style.display = 'none';
}

function iniciarJuego() {
    if (btnLogout) btnLogout.style.display = 'block'; 
    btnPlay.style.display = 'none'; // Ya no se usa como reproductor principal de control inicial
    setupSection.style.display = 'flex';
    obtenerCancionesSpotify(); 
}

function cerrarSesion() {
    localStorage.removeItem('spotify_token');
    localStorage.removeItem('token_expiry');
    localStorage.removeItem('pkce_code_verifier');
    window.location.reload();
}

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
// 3. SISTEMA DE AUTENTICACIÓN
// ==========================================================================
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

// ==========================================================================
// 4. CONEXIÓN CON LA API DE SPOTIFY
// ==========================================================================
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

// ==========================================================================
// 5. NUEVA LÓGICA MULTIEQUIPO Y TABLERO
// ==========================================================================
btnStartGame.addEventListener('click', () => {
    const totalEquipos = parseInt(document.getElementById('num-teams').value) || 2;
    equipos = [];
    
    for(let i = 1; i <= totalEquipos; i++) {
        equipos.push({
            id: i,
            nombre: `Equipo ${i}`,
            fichas: 5,
            lineaTiempo: [] // Array de canciones ordenadas
        });
    }

    setupSection.style.display = 'none';
    gamePlaySection.style.display = 'flex';
    
    // Repartir carta inicial obligatoria a cada equipo para arrancar su línea temporal
    equipos.forEach(eq => {
        const indice = Math.floor(Math.random() * cancionesJuego.length);
        const cartaInicial = cancionesJuego.splice(indice, 1)[0];
        eq.lineaTiempo.push(cartaInicial);
    });

    actualizarTableroVisual();
    nuevoTurno();
});

function actualizarTableroVisual() {
    teamsBoard.innerHTML = '';
    equipos.forEach((eq, index) => {
        const contenedorEq = document.createElement('div');
        contenedorEq.style.cssText = `background: #1e1e1e; padding: 15px; border-radius: 10px; border: 2px solid ${index === turnoActual ? 'var(--accent-color)' : '#333'}`;
        
        // Cabecera Equipo
        contenedorEq.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom: 10px; font-weight:bold;">
                <span style="color: ${index === turnoActual ? 'var(--accent-color)' : 'white'}">${eq.nombre} ${index === turnoActual ? '(Jugando)' : ''}</span>
                <span style="color: #e67e22;">🪙 Fichas: ${eq.fichas}</span>
            </div>
            <div class="timeline-container" id="tl-eq-${eq.id}"></div>
        `;
        
        teamsBoard.appendChild(contenedorEq);
        const tlContenedor = document.getElementById(`tl-eq-${eq.id}`);
        
        // Renderizar mini cartas ordenadas por año
        eq.lineaTiempo.sort((a,b) => a.anio - b.anio).forEach(cancion => {
            const miniCarta = document.createElement('div');
            miniCarta.classList.add('timeline-card');
            miniCarta.innerHTML = `
                <div class="title" title="${cancion.titulo}">${cancion.titulo}</div>
                <div class="year">${cancion.anio}</div>
            `;
            tlContenedor.appendChild(miniCarta);
        });
    });
}

function nuevoTurno() {
    apuestasRivales = {};
    rivalsBetPanel.style.display = 'none';
    btnResolveTurn.style.display = 'none';
    btnReveal.style.display = 'block';
    btnSkip.style.display = 'block';
    secretCard.classList.add('hidden');
    
    skipCostSpan.textContent = costoPasarCancion;
    turnIndicator.textContent = `Turno activo: ${equipos[turnoActual].nombre}`;
    
    // Seleccionar y disparar audio de la canción misteriosa
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

// Calcula los "huecos" disponibles en la línea temporal para poder apostar
function prepararSelectorEspacios() {
    selectPlacement.innerHTML = '';
    const lt = equipos[turnoActual].lineaTiempo;
    
    // Opción única si no hay cartas, o extremos
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

// ==========================================================================
// 6. CONTROLADORES DE ACCIONES Y APUESTAS
// ==========================================================================

// Pasar canción progresivo
btnSkip.addEventListener('click', () => {
    const eq = equipos[turnoActual];
    if (eq.fichas < costoPasarCancion) {
        alert("¡No tienes suficientes fichas para pasar de canción!");
        return;
    }
    eq.fichas -= costoPasarCancion;
    costoPasarCancion++; // Sube para el siguiente intento
    audioPlayer.pause();
    nuevoTurno();
});

// Revelar carta y abrir apuestas de rivales
btnReveal.addEventListener('click', () => {
    audioPlayer.pause();
    secretCard.classList.remove('hidden');
    btnReveal.style.display = 'none';
    btnSkip.style.display = 'none';
    
    // Construir dinámicamente apuestas para los rivales
    rivalsButtonsContainer.innerHTML = '';
    equipos.forEach((eq, index) => {
        if(index !== turnoActual && eq.fichas > 0) {
            const divRival = document.createElement('div');
            divRival.style.cssText = "display:flex; gap:10px; align-items:center; background:#252525; padding:5px; border-radius:5px;";
            
            // Selector de espacio para el rival
            const selRival = document.createElement('select');
            selRival.id = `select-rival-${eq.id}`;
            selRival.style.cssText = "padding:5px; background:#444; color:white; border:none; border-radius:3px;";
            
            // Duplicamos opciones del selector principal para el robo
            Array.from(selectPlacement.options).forEach(opt => {
                const clone = opt.cloneNode(true);
                selRival.appendChild(clone);
            });

            divRival.innerHTML = `<span>${eq.nombre}:</span>`;
            
            const btnRobar = document.createElement('button');
            btnRobar.textContent = "Apostar Robo (1 🪙)";
            btnRobar.style.cssText = "padding:5px 10px; font-size:0.8rem; width:auto; background:#ff0080; color:white;";
            
            btnRobar.onclick = () => {
                apuestasRivales[eq.id] = parseInt(selRival.value);
                btnRobar.textContent = "💥 ¡Apuesta Registrada!";
                btnRobar.disabled = true;
            };

            divRival.appendChild(selRival);
            divRival.appendChild(btnRobar);
            rivalsButtonsContainer.appendChild(divRival);
        }
    });

    rivalsBetPanel.style.display = 'block';
    btnResolveTurn.style.display = 'block';
});

// Resolver el turno completo
btnResolveTurn.addEventListener('click', () => {
    const eqActivo = equipos[turnoActual];
    const anioCorrecto = cancionActual.anio;
    const posicionElegida = parseInt(selectPlacement.value);
    
    // Clonamos y añadimos la carta temporalmente para validar posición exacta
    let copiaLinea = [...eqActivo.lineaTiempo];
    copiaLinea.push(cancionActual);
    copiaLinea.sort((a,b) => a.anio - b.anio);
    const indiceCorrectoReal = copiaLinea.indexOf(cancionActual);

    let activoHaAcertado = (posicionElegida === indiceCorrectoReal);

    // 1. Resolver apuestas secundarias del jugador activo (artista / titulo)
    if(document.getElementById('check-artist').checked) {
        // En un juego real esto requerirá juicio de los contrincantes, simulamos acierto/fallo automático para agilizar
        const aciertoArt = confirm(`¿El ${eqActivo.nombre} dijo correctamente el artista: ${cancionActual.artista}?`);
        eqActivo.fichas += aciertoArt ? 1 : -1;
    }
    if(document.getElementById('check-title').checked) {
        const aciertoTit = confirm(`¿El ${eqActivo.nombre} dijo correctamente el título: ${cancionActual.titulo}?`);
        eqActivo.fichas += aciertoTit ? 1 : -1;
    }

    // 2. Resolver posición del jugador activo
    if (activoHaAcertado) {
        alert(`¡${eqActivo.nombre} acertó el año! La canción se añade a su línea.`);
        eqActivo.lineaTiempo.push(cancionActual);
    } else {
        alert(`¡${eqActivo.nombre} falló! El año correcto era ${anioCorrecto}.`);
    }

    // 3. Resolver robos de los rivales
    equipos.forEach(eq => {
        if(apuestasRivales[eq.id] !== undefined) {
            if(apuestasRivales[eq.id] === indiceCorrectoReal) {
                alert(`🎉 ¡${eq.nombre} robó el punto con éxito! Gana la carta y 1 ficha.`);
                eq.lineaTiempo.push(cancionActual);
                eq.fichas += 1;
            } else {
                alert(`❌ ${eq.nombre} falló el robo. Pierde 1 ficha.`);
                eq.fichas -= 1;
            }
        }
    });

    // Resetear checkboxes secundarios
    document.getElementById('check-artist').checked = false;
    document.getElementById('check-title').checked = false;

    // Control de mínimos de fichas
    equipos.forEach(e => { if(e.fichas < 0) e.fichas = 0; });

    // Comprobar condición de victoria (10 canciones en línea temporal)
    const ganador = equipos.find(e => e.lineaTiempo.length >= 10);
    if(ganador) {
        alert(`🏆 ¡FIN DE LA PARTIDA! El ${ganador.nombre} ha ganado el juego con 10 éxitos colocados.`);
        window.location.reload();
        return;
    }

    // Pasar turno al siguiente equipo y resetear costos de salto de canción por ronda
    turnoActual = (turnoActual + 1) % equipos.length;
    costoPasarCancion = 1; 
    nuevoTurno();
});

if (btnLogout) {
    btnLogout.addEventListener('click', cerrarSesion);
}

function cargarCancionesRespaldo() {
    cancionesJuego = [
        { titulo: "Bohemian Rhapsody", artista: "Queen", anio: 1975, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
        { titulo: "Thriller", artista: "Michael Jackson", anio: 1982, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
        { titulo: "Stayin Alive", artista: "Bee Gees", anio: 1977, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
        { titulo: "A Quién Le Importa", artista: "Alaska y Dinarama", anio: 1986, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" },
        { titulo: "Devuélveme a mi chica", artista: "Hombres G", anio: 1985, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" },
        { titulo: "Un Año Más", artista: "Mecano", anio: 1988, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" },
        { titulo: "Macarena", artista: "Los Del Río", anio: 1993, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3" },
        { titulo: "Corazón Partío", artista: "Alejandro Sanz", anio: 1997, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3" },
        { titulo: "Wannabe", artista: "Spice Girls", anio: 1996, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3" },
        { titulo: "La Flaca", artista: "Jarabe de Palo", anio: 1996, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3" },
        { titulo: "Caminando por la vida", artista: "Melendi", anio: 2005, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3" },
        { titulo: "Zapatillas", artista: "El Canto del Loco", anio: 2005, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3" },
        { titulo: "Aserejé", artista: "Las Ketchup", anio: 2002, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3" },
        { titulo: "Gasolina", artista: "Daddy Yankee", anio: 2004, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3" },
        { titulo: "Colgando en tus manos", artista: "Carlos Baute ft. Marta Sánchez", anio: 2008, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
        { titulo: "Por la boca vive el pez", artista: "Fito & Fitipaldis", anio: 2006, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
        { titulo: "Bailando", artista: "Enrique Iglesias", anio: 2014, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
        { titulo: "Malamente", artista: "Rosalía", anio: 2018, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" },
        { titulo: "Todo De Ti", artista: "Rauw Alejandro", anio: 2021, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" },
        { titulo: "Nochentera", artista: "Vicco", anio: 2023, audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3" }
    ];
    siguienteCancionSimulada();
}

function siguienteCancionSimulada() {
    // Redirección de compatibilidad con el sistema antiguo de inicio automático
    console.log("Banco de datos listo para el multijugador.");
}

verificarToken();