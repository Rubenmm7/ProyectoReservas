import { apiFetch } from '../utils/http';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { persistSession } from '../utils/session';
import macrosadLogo from '../assets/isotipo-petalos.svg';
import WaveCanvas from '../components/WaveCanvas.jsx';
import HeroLogo from '../components/HeroLogo.jsx';

const PINK = '#E5007D';
const DARK_BG = '#1a1625';
const DARK_CARD = 'rgba(255,255,255,0.07)';
const DARK_INPUT_BG = '#2d2739';
const DARK_BORDER = 'rgba(255,255,255,0.12)';

// ── Icono Microsoft ───────────────────────────────────────────────
const MSIcon = () => (
  <svg width="18" height="18" viewBox="0 0 21 21" style={{ flexShrink: 0 }}>
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

// ── Icono ojo ─────────────────────────────────────────────────────
const EyeIcon = ({ open }) =>
  open ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );

// ── Tarjetas de proceso ───────────────────────────────────────────
const PROCESS_STEPS = [
  { n: '1', title: 'Solicitud', text: 'Indica la fecha, hora de salida, destino y el vehículo disponible en tu centro.' },
  { n: '2', title: 'Validación', text: 'El responsable de flota revisa la solicitud y confirma la asignación del vehículo.' },
  { n: '3', title: 'Recogida', text: 'El vehículo queda reservado a tu nombre. Recógelo en el punto habitual de tu centro.' },
];

const ProcessCards = ({ dark }) => (
  <div style={{ display: 'flex', gap: 12 }}>
    {PROCESS_STEPS.map(({ n, title, text }) => (
      <div
        key={n}
        style={{
          flex: 1, borderRadius: 14,
          border: `1px solid ${dark ? 'rgba(255,255,255,.07)' : '#efefef'}`,
          padding: '14px',
          background: dark ? 'rgba(255,255,255,.03)' : '#fff',
          boxShadow: dark ? 'none' : '0 1px 4px rgba(15,23,42,.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            background: dark ? 'rgba(229,0,125,.18)' : 'rgba(229,0,125,.1)',
            border: '1px solid rgba(229,0,125,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800, color: PINK,
          }}>{n}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: dark ? '#e2e8f0' : '#0f172a' }}>{title}</span>
        </div>
        <p style={{ fontSize: 11, color: dark ? '#94a3b8' : '#4b5563', lineHeight: 1.6 }}>{text}</p>
      </div>
    ))}
  </div>
);

// ── Login principal ───────────────────────────────────────────────
function Login() {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [errors, setErrors] = useState({ username: '', password: '', general: '' });
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [focused, setFocused] = useState({ username: false, password: false });
  const navigate = useNavigate();

  useEffect(() => {
    const stored = localStorage.getItem('theme') === 'dark';
    setDark(stored);
    document.documentElement.classList.toggle('dark', stored);
  }, []);

  useEffect(() => {
    if (!isMobile) return;

    const body = document.body;
    const html = document.documentElement;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyHeight = body.style.height;
    const prevHtmlHeight = html.style.height;

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.style.height = '100%';
    html.style.height = '100%';

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.height = prevBodyHeight;
      html.style.height = prevHtmlHeight;
    };
  }, [isMobile]);

  // Dimensiones del panel izquierdo para el canvas de olas
  const wrapRef = useRef(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const targetRef = useRef({ x: 0.5, y: 0.5 });
  const frameRef = useRef(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  // Medir el contenedor al montar y al redimensionar
  useEffect(() => {
    const update = () => {
      if (!wrapRef.current) return;
      setDims({ w: wrapRef.current.offsetWidth, h: wrapRef.current.offsetHeight });
      setIsMobile(window.innerWidth < 768);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Seguimiento suavizado del ratón
  useEffect(() => {
    const tick = () => {
      mouseRef.current.x += (targetRef.current.x - mouseRef.current.x) * 0.06;
      mouseRef.current.y += (targetRef.current.y - mouseRef.current.y) * 0.06;
      frameRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    targetRef.current = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }, []);

  // ── Leer token de la URL (login externo) ─────────────────────
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const errorParam = query.get('error');

    if (errorParam === 'session_expired') {
      setErrors({ username: '', password: '', general: 'Tu sesión ha caducado por inactividad. Por favor, vuelve a iniciar sesión.' });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    const userRaw = query.get('user');
    if (!userRaw) return;

    let parsedUser;
    try {
      parsedUser = JSON.parse(userRaw);
    } catch {
      setErrors({ username: '', password: '', general: 'Datos de usuario inválidos' });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (!parsedUser || typeof parsedUser !== 'object') {
      setErrors({ username: '', password: '', general: 'Datos de usuario inválidos' });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    persistSession({ user: parsedUser, centres: parsedUser.centres || [] });
    // Limpiar la URL para no dejar el token en el historial del navegador
    window.history.replaceState({}, '', window.location.pathname);
    window.dispatchEvent(new Event('session-auth-changed'));
    navigate('/inicio', { replace: true });
  }, [navigate]);

  const handleExternalLogin = () => {
    window.location.href = '/api/auth/externo';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrors({ username: '', password: '', general: '' });

    let hasErrors = false;
    const newErrors = { username: '', password: '', general: '' };

    if (!formData.username.trim()) {
      newErrors.username = 'Introduce un nombre de usuario';
      hasErrors = true;
    }
    if (!formData.password.trim()) {
      newErrors.password = 'La contraseña no puede estar vacía';
      hasErrors = true;
    }

    if (hasErrors) {
      setErrors(newErrors);
      setLoading(false);
      return;
    }

    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();

      if (response.ok && data.user) {
        persistSession({ user: data.user, centres: data.user?.centres || [] });
        window.dispatchEvent(new Event('session-auth-changed'));
        navigate('/inicio');
        return;
      }

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        setErrors({ username: '', password: '', general: 'Usuario o contraseña incorrectos' });
      } else {
        setErrors({ username: '', password: '', general: data.error || 'Error al iniciar sesión' });
      }
    } catch {
      setErrors({ username: '', password: '', general: 'Error de conexión con el servidor' });
    } finally {
      setLoading(false);
    }
  };

  const inputBase = {
    width: '100%', borderRadius: 14, padding: '12px 16px', fontSize: 15,
    outline: 'none', fontFamily: 'inherit',
    transition: 'border-color .2s, box-shadow .2s, background .3s, color .3s',
    background: dark ? DARK_INPUT_BG : '#fff',
    color: dark ? '#f1f5f9' : '#0f172a',
  };

  const inputBorder = (field) => {
    if (focused[field]) return `1.5px solid ${PINK}`;
    if (errors[field]) return '1.5px solid #f87171';
    return `1.5px solid ${dark ? 'rgba(255,255,255,.18)' : '#e2e8f0'}`;
  };

  const inputShadow = (field) =>
    focused[field] ? `0 0 0 3px ${PINK}26` : 'none';
  const compactMobile = isMobile;

  // ── Bloque de formulario compartido ─────────────────────────────
  const formBlock = (
    <>
      <div style={{ marginBottom: compactMobile ? 18 : 28 }}>
        <h2 style={{ fontSize: compactMobile ? 22 : 24, fontWeight: 800, color: dark ? '#ffffff' : '#0f172a', letterSpacing: '-.02em', transition: 'color .3s' }}>
          Accede a tu cuenta
        </h2>
      </div>

      {errors.general && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            marginBottom: compactMobile ? 12 : 16, borderRadius: 14,
            border: `1px solid ${dark ? 'rgba(248,113,113,.3)' : '#fecaca'}`,
            background: dark ? 'rgba(220,38,38,.15)' : '#fef2f2',
            padding: compactMobile ? '10px 14px' : '12px 16px',
            fontSize: compactMobile ? 13 : 14, fontWeight: 500, color: dark ? '#fca5a5' : '#dc2626',
          }}
        >
          {errors.general}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: compactMobile ? 12 : 16 }}>
        <button
          type="button"
          onClick={handleExternalLogin}
          style={{
            width: '100%', borderRadius: 14,
            border: `1.5px solid ${dark ? DARK_BORDER : '#e2e8f0'}`,
            background: dark ? 'rgba(255,255,255,.06)' : '#fff',
            color: dark ? '#e2e8f0' : '#334155',
            fontWeight: 700, fontSize: compactMobile ? 14 : 15,
            padding: compactMobile ? '12px' : '14px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 10, fontFamily: 'inherit',
            boxShadow: dark ? 'none' : '0 2px 8px rgba(15,23,42,.06)',
            transition: 'border-color .2s, background .2s, color .3s',
          }}
        >
          <MSIcon /> Continuar con Microsoft 365
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, height: 1, background: dark ? DARK_BORDER : '#e2e8f0', transition: 'background .3s' }} />
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: dark ? '#94a3b8' : '#4b5563', whiteSpace: 'nowrap',
          }}>
            o con usuario
          </span>
          <div style={{ flex: 1, height: 1, background: dark ? DARK_BORDER : '#e2e8f0', transition: 'background .3s' }} />
        </div>

        <div>
          <label htmlFor="login-username" style={{ fontSize: compactMobile ? 12 : 13, fontWeight: 600, color: dark ? '#94a3b8' : '#475569', marginBottom: 6, display: 'block' }}>
            Usuario
          </label>
          <input
            id="login-username"
            type="text"
            autoFocus
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            onFocus={() => setFocused((f) => ({ ...f, username: true }))}
            onBlur={() => setFocused((f) => ({ ...f, username: false }))}
            placeholder="Tu usuario"
            aria-invalid={!!errors.username}
            aria-describedby={errors.username ? 'username-error' : undefined}
            style={{ ...inputBase, padding: compactMobile ? '11px 14px' : inputBase.padding, border: inputBorder('username'), boxShadow: inputShadow('username') }}
          />
          {errors.username && (
            <p id="username-error" role="alert" style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', marginTop: 5 }}>{errors.username}</p>
          )}
        </div>

        <div>
          <label htmlFor="login-password" style={{ fontSize: compactMobile ? 12 : 13, fontWeight: 600, color: dark ? '#94a3b8' : '#475569', marginBottom: 6, display: 'block' }}>
            Contraseña
          </label>
          <div style={{ position: 'relative' }}>
            <input
              id="login-password"
              type={showPwd ? 'text' : 'password'}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              onFocus={() => setFocused((f) => ({ ...f, password: true }))}
              onBlur={() => setFocused((f) => ({ ...f, password: false }))}
              placeholder="••••••••"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              style={{ ...inputBase, padding: compactMobile ? '11px 14px' : inputBase.padding, paddingRight: 48, border: inputBorder('password'), boxShadow: inputShadow('password') }}
            />
            <button
              type="button"
              onClick={() => setShowPwd(!showPwd)}
              aria-label={showPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              style={{
                position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: dark ? '#94a3b8' : '#64748b',
                minWidth: 44, minHeight: 44,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <EyeIcon open={showPwd} />
            </button>
          </div>
          {errors.password && (
            <p id="password-error" role="alert" style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', marginTop: 5 }}>{errors.password}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: '20px',
            width: '100%', borderRadius: 14,
            background: loading ? '#f9a8d4' : PINK,
            color: '#fff', fontWeight: 700, fontSize: compactMobile ? 14 : 15,
            padding: compactMobile ? '12px' : '14px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            boxShadow: dark ? `0 8px 32px ${PINK}60` : `0 8px 24px ${PINK}40`,
            transition: 'filter .15s, transform .1s, box-shadow .3s',
          }}
        >
          {loading ? 'Entrando…' : 'Iniciar sesión'}
        </button>
      </form>
    </>
  );

  // ── Layout móvil ─────────────────────────────────────────────────
  if (isMobile) {
    const mobileBg = dark
      ? DARK_BG
      : '#f3f0f8';
    const mobileGradient = dark
      ? 'radial-gradient(ellipse 120% 55% at 50% 0%, rgba(139,92,246,.22) 0%, transparent 65%), radial-gradient(ellipse 80% 40% at 80% 10%, rgba(229,0,125,.12) 0%, transparent 55%)'
      : 'radial-gradient(ellipse 120% 55% at 50% 0%, rgba(229,0,125,.13) 0%, transparent 60%), radial-gradient(ellipse 80% 40% at 80% 10%, rgba(139,92,246,.10) 0%, transparent 55%)';

    return (
      <main
        ref={wrapRef}
        style={{
          width: '100%',
          height: '100dvh',
          minHeight: '100dvh',
          background: mobileBg,
          display: 'flex', flexDirection: 'column',
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          position: 'fixed', inset: 0, overflow: 'hidden',
          overscrollBehavior: 'none',
          transition: 'background .3s',
        }}
      >
        {/* Gradiente decorativo mobile */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: mobileGradient }} />

        {/* Hero */}
        <div style={{
          flex: '1 1 auto', display: 'flex', flexDirection: 'column',
          padding: '12px 18px 0', position: 'relative', zIndex: 1,
          minHeight: 0,
        }}>
          {/* Logo + nombre */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: dark ? 'rgba(255,255,255,.08)' : 'rgba(229,0,125,.12)',
              boxShadow: '0 2px 12px rgba(229,0,125,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <img src={macrosadLogo} alt="Macrosad" width="24" height="24" style={{ objectFit: 'contain' }} />
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.22em', color: PINK, textTransform: 'uppercase' }}>Macrosad</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a', marginTop: 1 }}>Reserva de vehículos</div>
            </div>
          </div>

          {/*Separador */}
          <div style={{ marginBottom: 20 }}></div>

          {/* Titular */}
          <h2 style={{
            fontSize: 29, fontWeight: 800,
            color: dark ? '#ffffff' : '#0f172a',
            lineHeight: 1.05, letterSpacing: '-.03em', marginBottom: 6,
          }}>
            Tu próximo viaje<br />de empresa.
          </h2>
          <p style={{ fontSize: 12.5, color: dark ? '#94a3b8' : '#4b5563', lineHeight: 1.45, marginBottom: 0, maxWidth: 290 }}>
            Revisa la disponibilidad de los vehículos, haz tus reservas y obtén confirmación desde aquí.
          </p>

          {/* Hero logo */}
          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 0', minHeight: 0, marginTop: 30 }}>
            <HeroLogo dark={dark} size={180} />
          </div>
        </div>

        {/* Card formulario */}
        <div style={{ padding: '0 12px calc(env(safe-area-inset-bottom))', position: 'relative', zIndex: 2, marginTop: -60 }}>
          <div style={{
            background: dark ? 'rgba(34,28,48,0.92)' : '#fff',
            border: `1px solid ${dark ? DARK_BORDER : 'rgba(229,0,125,.10)'}`,
            borderRadius: '28px 28px 0 0',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            gap: 10,
            padding: '32px 24px 24px',
            boxShadow: dark
              ? '0 16px 48px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06)'
              : '0 8px 40px rgba(139,92,246,.10)',
            backdropFilter: dark ? 'blur(20px)' : 'none',
            transform: 'translateY(0)',
            minHeight: '53vh',
            maxHeight: '75vh',
            overflow: 'hidden',
          }}>
            {formBlock}
          </div>
        </div>
      </main>
    );
  }

  // ── Layout escritorio ─────────────────────────────────────────────
  return (
    <main
      ref={wrapRef}
      onMouseMove={handleMouseMove}
      style={{
        minHeight: 'calc(100vh / 1.25)',
        background: dark ? DARK_BG : '#f8f9fb',
        display: 'flex', position: 'relative', overflow: 'hidden',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        zoom: 1.25,
        transition: 'background .3s',
      }}
    >
      {/* ── Fondo de olas ── */}
      {dims.w > 0 && (
        <WaveCanvas width={dims.w} height={dims.h} dark={dark} mouseRef={mouseRef} />
      )}

      {/* ── Dot grid ── */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        opacity: dark ? .10 : .28,
        backgroundImage: `radial-gradient(${dark ? '#a78bfa' : '#cbd5e1'} 1px, transparent 1px)`,
        backgroundSize: '28px 28px',
        transition: 'opacity .3s',
      }} />

      {/* ── Gradiente decorativo oscuro ── */}
      {dark && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 70% 60% at 20% 50%, rgba(139,92,246,.12) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 80% 20%, rgba(229,0,125,.08) 0%, transparent 60%)',
        }} />
      )}

      {/* PANEL IZQUIERDO — hero */}
      <div style={{
        flex: '0 0 52%', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', padding: '52px 56px',
        position: 'relative', zIndex: 1,
        transition: 'border-color .3s',
      }}>
        {/* Logo + nombre */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: dark ? 'rgba(255,255,255,.08)' : '#fff',
            boxShadow: dark ? '0 2px 16px rgba(229,0,125,.25)' : '0 2px 16px rgba(229,0,125,.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .3s, box-shadow .3s',
          }}>
            <img src={macrosadLogo} alt="Macrosad" width="28" height="28" style={{ objectFit: 'contain' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.24em', color: PINK, textTransform: 'uppercase' }}>Macrosad</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a', marginTop: 1, transition: 'color .3s' }}>Reserva de vehículos de empresa</div>
          </div>
        </div>

        {/* Titular */}
        <div>
          <h2 style={{
            fontSize: 50, fontWeight: 800,
            color: dark ? '#ffffff' : '#0f172a',
            lineHeight: 1.08, letterSpacing: '-.03em', marginBottom: 18,
            textWrap: 'pretty', transition: 'color .3s',
          }}>
            Tu próximo viaje<br />de empresa.
          </h2>
          <p style={{ fontSize: 16, color: dark ? '#94a3b8' : '#4b5563', lineHeight: 1.75, maxWidth: 390, transition: 'color .3s' }}>
            Consulta la disponibilidad de vehículos, tramita tu reserva y recibe
            la confirmación.
          </p>
        </div>

        {/* HeroLogo + tarjetas */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 40 }}>
            <HeroLogo dark={dark} size={220} />
          </div>
          <ProcessCards dark={dark} />
        </div>
      </div>

      {/* PANEL DERECHO — formulario */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '52px 48px', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          width: '100%', maxWidth: 380,
          background: dark ? DARK_CARD : '#fff',
          border: `1px solid ${dark ? DARK_BORDER : '#f1f5f9'}`,
          borderRadius: 28,
          padding: '40px 36px',
          boxShadow: dark
            ? '0 24px 64px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06)'
            : '0 24px 64px rgba(15,23,42,.08)',
          backdropFilter: dark ? 'blur(16px)' : 'none',
          transition: 'background .3s, border-color .3s, box-shadow .3s',
        }}>
          {formBlock}
        </div>
      </div>
    </main>
  );
}

export default Login;

