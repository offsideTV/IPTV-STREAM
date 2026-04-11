// ── cast.js — Módulo de transmisión a dispositivos ────────────────────────
// Soporta:
//   1. Chromecast / Google Cast (Chrome desktop + Android Chrome)
//   2. Fallback manual: muestra modal con opciones para otros dispositivos
// Solo funciona con canales HLS (m3u8). Los DRM (iframeUrl) quedan deshabilitados.
// ─────────────────────────────────────────────────────────────────────────────

const Cast = (() => {

    // ── Estado interno ────────────────────────────────────────────────────
    let _castAvailable  = false;   // La API de Cast está lista
    let _castSession    = null;    // Sesión Cast activa
    let _currentUrl     = null;    // URL m3u8 actualmente en reproducción
    let _currentTitle   = '';
    let _currentPoster  = '';
    let _isDRM          = false;   // Canal actual es DRM
    let _castBtn        = null;
    let _castModal      = null;
    let _showToastFn    = null;    // Referencia a showToast del main script

    // APP_ID se usa dentro de _initCastApi cuando el SDK ya está cargado
    const APP_ID = 'CC1AD845'; // Default Media Receiver (siempre válido)

    // ── Inicialización ────────────────────────────────────────────────────
    function init(showToastCallback) {
        _showToastFn = showToastCallback;
        _buildButton();
        _buildModal();
        _loadCastSDK();
    }

    // ── Cargar SDK de Google Cast ─────────────────────────────────────────
    function _loadCastSDK() {
        // El SDK de Cast solo funciona en Chrome (desktop/Android)
        // En otros browsers el botón muestra el fallback manual
        window['__onGCastApiAvailable'] = (isAvailable) => {
            if (isAvailable) {
                _castAvailable = true;
                _initCastApi();
            }
        };

        const script = document.createElement('script');
        script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
        script.onerror = () => {
            // SDK no cargó (no es Chrome o bloqueado) — fallback manual
            _castAvailable = false;
        };
        document.head.appendChild(script);
    }

    // ── Configurar Cast Framework ─────────────────────────────────────────
    function _initCastApi() {
        if (!window.cast || !cast.framework) return;

        const context = cast.framework.CastContext.getInstance();
        context.setOptions({
            receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID || APP_ID,
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });

        context.addEventListener(
            cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
            (event) => {
                const S = cast.framework.SessionState;
                if (event.sessionState === S.SESSION_STARTED ||
                    event.sessionState === S.SESSION_RESUMED) {
                    _castSession = context.getCurrentSession();
                    _setCastActive(true);
                    if (_currentUrl) _loadMediaOnCast(_currentUrl, _currentTitle, _currentPoster);
                } else if (event.sessionState === S.SESSION_ENDED) {
                    _castSession = null;
                    _setCastActive(false);
                    if (_showToastFn) _showToastFn('Transmisión finalizada');
                }
            }
        );
    }

    // ── Cargar media en el receptor Cast ─────────────────────────────────
    function _loadMediaOnCast(url, title, poster) {
        if (!_castSession) return;

        const mediaInfo = new chrome.cast.media.MediaInfo(url, 'application/x-mpegURL');
        mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
        mediaInfo.metadata.title = title;
        if (poster) mediaInfo.metadata.images = [{ url: poster }];
        mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;

        const request = new chrome.cast.media.LoadRequest(mediaInfo);
        request.autoplay = true;

        _castSession.loadMedia(request)
            .then(() => {
                if (_showToastFn) _showToastFn(`Transmitiendo: ${title}`);
            })
            .catch((err) => {
                console.warn('Cast loadMedia error:', err);
                if (_showToastFn) _showToastFn('Error al transmitir');
            });
    }

    // ── Botón Cast en el OSD ──────────────────────────────────────────────
    function _buildButton() {
        _castBtn = document.createElement('button');
        _castBtn.className = 'osd-btn';
        _castBtn.id = 'cast-btn';
        _castBtn.title = 'Transmitir a dispositivo';
        _castBtn.innerHTML = `
            <svg id="cast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 8.5A12.5 12.5 0 0 1 14.5 21"/>
                <path d="M2 13a8 8 0 0 1 8 8"/>
                <circle cx="2" cy="21" r="1" fill="currentColor" stroke="none"/>
                <rect x="14" y="3" width="8" height="14" rx="2"/>
                <path d="M14 20h8" stroke-width="1.5"/>
                <path d="M17 23h2"/>
            </svg>`;

        _castBtn.addEventListener('click', _onCastClick);

        // Insertar antes del botón fullscreen
        const osdActions = document.querySelector('.osd-actions');
        if (osdActions) {
            const fsBtn = document.getElementById('fs-btn');
            osdActions.insertBefore(_castBtn, fsBtn);
        }
    }

    // ── Modal fallback para no-Chrome ──────────────────────────────────────
    function _buildModal() {
        _castModal = document.createElement('div');
        _castModal.id = 'cast-modal';
        _castModal.innerHTML = `
            <div id="cast-modal-inner">
                <div id="cast-modal-header">
                    <span id="cast-modal-title">Transmitir a dispositivo</span>
                    <button id="cast-modal-close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                             stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <p id="cast-modal-subtitle">Copiá el link y abrilo en tu dispositivo</p>
                <div id="cast-url-box">
                    <span id="cast-url-text"></span>
                    <button id="cast-copy-btn" title="Copiar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                    </button>
                </div>
                <div id="cast-options">
                    <button class="cast-option-btn" id="cast-opt-vlc">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                            <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" opacity="0.7"/>
                        </svg>
                        Abrir en VLC
                    </button>
                    <button class="cast-option-btn" id="cast-opt-kodi">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                            <rect x="3" y="3" width="18" height="14" rx="2"/>
                            <path d="M8 21h8M12 17v4"/>
                        </svg>
                        Abrir en Kodi / IPTV
                    </button>
                    <button class="cast-option-btn" id="cast-opt-share">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                        </svg>
                        Compartir link
                    </button>
                </div>
                <p id="cast-modal-hint">
                    En Android TV / Smart TV: abrí un navegador compatible con HLS o instalá IPTV Smarters / TiviMate y pegá la URL.
                </p>
            </div>`;

        // Estilos del modal
        const style = document.createElement('style');
        style.textContent = `
            #cast-modal {
                position: fixed; inset: 0; z-index: 150;
                display: flex; align-items: center; justify-content: center;
                background: rgba(0,0,0,0.65); backdrop-filter: blur(8px);
                opacity: 0; pointer-events: none;
                transition: opacity 0.25s ease;
            }
            #cast-modal.visible { opacity: 1; pointer-events: auto; }
            #cast-modal-inner {
                background: rgba(18,18,18,0.97);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 18px; padding: 1.5rem 1.75rem;
                width: min(420px, 92vw); display: flex; flex-direction: column; gap: 0.85rem;
                box-shadow: 0 24px 60px rgba(0,0,0,0.7);
            }
            #cast-modal-header {
                display: flex; align-items: center; justify-content: space-between;
            }
            #cast-modal-title {
                font-size: 0.95rem; font-weight: 700; letter-spacing: -0.02em;
            }
            #cast-modal-close {
                background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
                border-radius: 8px; padding: 5px; cursor: pointer; color: #fff;
                display: flex; align-items: center; justify-content: center;
                transition: background 0.15s;
            }
            #cast-modal-close:hover { background: rgba(255,255,255,0.18); }
            #cast-modal-subtitle {
                font-size: 0.75rem; color: rgba(255,255,255,0.4); margin-top: -0.3rem;
            }
            #cast-url-box {
                display: flex; align-items: center; gap: 0.5rem;
                background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
                border-radius: 10px; padding: 0.6rem 0.75rem;
            }
            #cast-url-text {
                flex: 1; font-size: 0.68rem; color: rgba(255,255,255,0.55);
                font-family: monospace; overflow: hidden; text-overflow: ellipsis;
                white-space: nowrap;
            }
            #cast-copy-btn {
                background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15);
                border-radius: 6px; padding: 5px 8px; cursor: pointer; color: #fff;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0; transition: background 0.15s;
            }
            #cast-copy-btn:hover { background: rgba(255,255,255,0.22); }
            #cast-options {
                display: flex; flex-direction: column; gap: 0.5rem;
            }
            .cast-option-btn {
                display: flex; align-items: center; gap: 0.65rem;
                background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);
                border-radius: 10px; padding: 0.7rem 1rem;
                color: rgba(255,255,255,0.8); font-size: 0.82rem; font-weight: 500;
                cursor: pointer; text-align: left;
                transition: background 0.15s, border-color 0.15s;
            }
            .cast-option-btn:hover {
                background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2);
                color: #fff;
            }
            .cast-option-btn:active { transform: scale(0.98); }
            #cast-modal-hint {
                font-size: 0.68rem; color: rgba(255,255,255,0.28); line-height: 1.5;
                border-top: 1px solid rgba(255,255,255,0.07); padding-top: 0.75rem;
            }

            /* Estado activo del botón cast */
            #cast-btn.casting {
                background: rgba(255,255,255,0.18);
                border-color: rgba(255,255,255,0.45);
            }
            #cast-btn.casting svg { color: #fff; }
            #cast-btn.disabled-drm {
                opacity: 0.25; cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(_castModal);

        // Eventos del modal
        document.getElementById('cast-modal-close').addEventListener('click', _closeModal);
        _castModal.addEventListener('click', (e) => { if (e.target === _castModal) _closeModal(); });

        document.getElementById('cast-copy-btn').addEventListener('click', () => {
            if (!_currentUrl) return;
            navigator.clipboard.writeText(_currentUrl).then(() => {
                if (_showToastFn) _showToastFn('Link copiado al portapapeles');
                _closeModal();
            }).catch(() => {
                // Fallback para dispositivos sin clipboard API
                const ta = document.createElement('textarea');
                ta.value = _currentUrl;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                if (_showToastFn) _showToastFn('Link copiado');
                _closeModal();
            });
        });

        document.getElementById('cast-opt-vlc').addEventListener('click', () => {
            if (!_currentUrl) return;
            // VLC acepta vlc:// como protocolo en algunos sistemas
            // En otros hay que usar intent:// (Android) o simplemente copiar
            const isAndroid = /Android/i.test(navigator.userAgent);
            if (isAndroid) {
                window.location.href = `intent:${_currentUrl}#Intent;package=org.videolan.vlc;action=android.intent.action.VIEW;type=application/x-mpegURL;end`;
            } else {
                window.open(`vlc://${_currentUrl}`, '_blank');
            }
            _closeModal();
        });

        document.getElementById('cast-opt-kodi').addEventListener('click', () => {
            if (!_currentUrl) return;
            navigator.clipboard.writeText(_currentUrl).then(() => {
                if (_showToastFn) _showToastFn('Link copiado — pegalo en Kodi / IPTV Smarters');
            }).catch(() => {});
            _closeModal();
        });

        document.getElementById('cast-opt-share').addEventListener('click', () => {
            if (!_currentUrl) return;
            if (navigator.share) {
                navigator.share({
                    title: _currentTitle,
                    text: `Transmitir: ${_currentTitle}`,
                    url: _currentUrl,
                }).catch(() => {});
            } else {
                navigator.clipboard.writeText(_currentUrl).catch(() => {});
                if (_showToastFn) _showToastFn('Link copiado al portapapeles');
            }
            _closeModal();
        });
    }

    // ── Click en el botón Cast ─────────────────────────────────────────────
    function _onCastClick() {
        if (_isDRM) {
            if (_showToastFn) _showToastFn('Los canales DRM no se pueden transmitir');
            return;
        }
        if (!_currentUrl) {
            if (_showToastFn) _showToastFn('No hay stream disponible');
            return;
        }

        if (_castAvailable && window.cast && cast.framework) {
            // Chromecast disponible → usar API nativa
            const context = cast.framework.CastContext.getInstance();

            if (_castSession) {
                // Ya hay sesión → enviar media o desconectar
                _loadMediaOnCast(_currentUrl, _currentTitle, _currentPoster);
            } else {
                // Abrir selector de dispositivos Chromecast
                context.requestSession().catch((err) => {
                    // Usuario canceló o no hay dispositivos → mostrar fallback
                    if (err !== chrome.cast.ErrorCode.CANCEL) {
                        _openModal();
                    }
                });
            }
        } else {
            // No hay Cast API → modal fallback
            _openModal();
        }
    }

    // ── Modal ─────────────────────────────────────────────────────────────
    function _openModal() {
        if (!_castModal || !_currentUrl) return;
        document.getElementById('cast-url-text').textContent = _currentUrl;
        document.getElementById('cast-modal-title').textContent =
            `Transmitir: ${_currentTitle}`;
        _castModal.classList.add('visible');
    }

    function _closeModal() {
        if (_castModal) _castModal.classList.remove('visible');
    }

    // ── Actualizar estado del botón ────────────────────────────────────────
    function _setCastActive(active) {
        if (!_castBtn) return;
        _castBtn.classList.toggle('casting', active);
        _castBtn.title = active ? 'Transmitiendo — click para cambiar canal' : 'Transmitir a dispositivo';
    }

    // ── API pública ────────────────────────────────────────────────────────

    /**
     * Llamar cuando cambia el canal.
     * @param {string|null} url   - URL m3u8 del canal activo (null si es DRM)
     * @param {string}      title - Nombre del canal
     * @param {string}      poster - URL del logo
     * @param {boolean}     isDRM - true si el canal es DRM (iframe)
     */
    function updateChannel(url, title, poster, isDRM) {
        _currentUrl    = url;
        _currentTitle  = title;
        _currentPoster = poster;
        _isDRM         = isDRM;

        if (!_castBtn) return;

        if (isDRM) {
            _castBtn.classList.add('disabled-drm');
            _castBtn.title = 'Transmisión no disponible para canales DRM';
        } else {
            _castBtn.classList.remove('disabled-drm');
            _castBtn.title = 'Transmitir a dispositivo';
        }

        // Si hay sesión activa, cambiar el contenido automáticamente
        if (_castSession && url && !isDRM) {
            _loadMediaOnCast(url, title, poster);
        }
    }

    /**
     * Llamar cuando cambia la fuente (srcIdx) dentro del mismo canal.
     * @param {string} url - Nueva URL m3u8
     */
    function updateSource(url) {
        _currentUrl = url;
        if (_castSession && url && !_isDRM) {
            _loadMediaOnCast(url, _currentTitle, _currentPoster);
        }
    }

    return { init, updateChannel, updateSource };

})();
