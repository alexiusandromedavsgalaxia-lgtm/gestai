import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { ArrowLeft, ArrowRight, Check, ExternalLink, LockKeyhole, ShieldCheck, Sparkles, X } from "lucide-react";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function getClient() {
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
}

const scopeLabels = {
  openid: ["Identidad básica", "Permite confirmar tu identidad mediante OpenID Connect."],
  email: ["Dirección de correo", "Permite compartir la dirección de correo asociada a tu cuenta."],
  profile: ["Información del perfil", "Permite compartir información básica de tu perfil."],
  phone: ["Número de teléfono", "Permite compartir el número de teléfono de tu cuenta, si está disponible."]
};

export default function OAuthConsent() {
  const supabase = useMemo(getClient, []);
  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");
  const [session, setSession] = useState(null);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(data?.session ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    let alive = true;
    if (!supabase || !session || !authorizationId) {
      setDetails(null);
      return () => { alive = false; };
    }
    setLoading(true);
    setError("");
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: requestError }) => {
      if (!alive) return;
      if (requestError) setError(requestError.message);
      else if (data && "authorization_id" in data) setDetails(data);
      else if (data?.redirect_url) window.location.assign(data.redirect_url);
      else setError("Supabase no ha devuelto los detalles de esta autorización.");
      setLoading(false);
    }).catch((requestError) => {
      if (alive) { setError(requestError.message || "No se pudo cargar la solicitud."); setLoading(false); }
    });
    return () => { alive = false; };
  }, [supabase, session, authorizationId]);

  async function signIn() {
    if (!supabase) return;
    setWorking(true);
    setError("");
    const redirectTo = window.location.href;
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { access_type: "offline", prompt: "consent" } }
    });
    if (signInError) { setError(signInError.message); setWorking(false); }
  }

  async function decide(action) {
    if (!supabase || !authorizationId || working) return;
    setWorking(true);
    setDecision(action);
    setError("");
    const method = action === "approve" ? "approveAuthorization" : "denyAuthorization";
    const { data, error: consentError } = await supabase.auth.oauth[method](authorizationId);
    if (consentError) {
      setError(consentError.message);
      setWorking(false);
      setDecision("");
      return;
    }
    if (data?.redirect_url) window.location.assign(data.redirect_url);
    else {
      setError("La autorización se ha procesado, pero Supabase no ha devuelto una dirección de retorno.");
      setWorking(false);
      setDecision("");
    }
  }

  const scopes = (details?.scope || "").split(" ").filter(Boolean);
  const client = details?.client || {};
  const clientHost = (() => {
    try { return new URL(client.uri).host; } catch { return client.uri || ""; }
  })();

  if (!supabase) return <main className="oauth-page"><section className="oauth-card"><Brand/><div className="oauth-state"><LockKeyhole/><h1>Falta configurar Supabase</h1><p>Añade <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> a las variables de entorno del proyecto y vuelve a desplegar.</p></div></section></main>;
  if (!authorizationId) return <main className="oauth-page"><section className="oauth-card"><Brand/><div className="oauth-state"><X/><h1>Solicitud incompleta</h1><p>Falta el parámetro <code>authorization_id</code>. Vuelve a la aplicación que inició la conexión y comienza el proceso otra vez.</p></div></section></main>;

  return <main className="oauth-page">
    <section className="oauth-card">
      <Brand/>
      <div className="oauth-kicker"><span className="oauth-dot"/> AUTORIZACIÓN SEGURA</div>
      {!session ? <>
        <div className="oauth-state">
          <div className="oauth-icon"><LockKeyhole/></div>
          <h1>Inicia sesión para continuar</h1>
          <p>Antes de compartir tus datos con otra aplicación, confirma tu cuenta de GestAI.</p>
          <button className="oauth-google" onClick={signIn} disabled={working}>{working ? "Abriendo Google…" : <><GoogleMark/> Continuar con Google</>}</button>
        </div>
      </> : loading ? <div className="oauth-state"><div className="oauth-spinner"/><h1>Preparando autorización</h1><p>Estamos consultando los permisos solicitados.</p></div> : details ? <>
        <div className="oauth-title"><h1>¿Conectar con esta aplicación?</h1><p>Revisa quién solicita acceso y qué información podrá recibir.</p></div>
        <div className="oauth-client">
          <div className="oauth-client-logo">{client.logo_uri ? <img src={client.logo_uri} alt="" referrerPolicy="no-referrer"/> : <Sparkles/>}</div>
          <div className="oauth-client-copy"><strong>{client.name || "Aplicación sin nombre"}</strong><span>{clientHost || "Aplicación externa"}</span>{client.uri && <a href={client.uri} target="_blank" rel="noreferrer">Visitar sitio <ExternalLink size={12}/></a>}</div>
        </div>
        <div className="oauth-account"><span>Conectando como</span><strong>{details.user?.email || session.user?.email || "Tu cuenta de GestAI"}</strong></div>
        <div className="oauth-permissions"><h2>Esta aplicación solicita</h2>
          {scopes.length ? scopes.map(scope => <div className="oauth-permission" key={scope}><span className="oauth-permission-icon"><ShieldCheck size={16}/></span><div><strong>{scopeLabels[scope]?.[0] || scope}</strong><p>{scopeLabels[scope]?.[1] || "Permiso solicitado por la aplicación para esta conexión."}</p></div></div>) : <p className="oauth-no-scopes">No se han solicitado permisos adicionales.</p>}
        </div>
        <p className="oauth-warning">Solo continúa si reconoces esta aplicación y confías en quien la ha creado. Puedes rechazar la solicitud sin perder tu cuenta.</p>
        {error && <div className="oauth-error" role="alert">{error}</div>}
        <div className="oauth-actions"><button className="oauth-deny" onClick={() => decide("deny")} disabled={working}><X size={16}/> Rechazar</button><button className="oauth-approve" onClick={() => decide("approve")} disabled={working}>{working ? "Procesando…" : <>Autorizar acceso <ArrowRight size={16}/></>}</button></div>
      </> : <div className="oauth-state"><div className="oauth-icon"><X/></div><h1>No se pudo cargar la solicitud</h1><p>{error || "La solicitud puede haber caducado o ya no estar disponible."}</p><button className="oauth-back" onClick={() => window.location.assign("/")}>Volver a GestAI <ArrowLeft size={15}/></button></div>}
      <footer className="oauth-footer"><ShieldCheck size={14}/> GestAI nunca compartirá datos sin tu autorización.</footer>
    </section>
  </main>;
}

function Brand() {
  return <a className="oauth-brand" href="/"><span><Sparkles size={18}/></span>gest<span>ai</span></a>;
}
function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.73 7.18l7.3 5.66c4.26-3.93 6.72-9.72 6.72-17.31Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.79l-7.3-5.66c-2.02 1.35-4.6 2.15-8.6 2.15-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}
