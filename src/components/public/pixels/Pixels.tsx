'use client'

import Script from 'next/script'
import type { ResolvedPixel } from './policy'

/**
 * The injected tags (doc 02 section 7): one nonced inline bootstrap that
 * sets Google Consent Mode v2 defaults and queues GA4 config, the GTM start
 * event and the Meta init, then the vendor loaders, then custom_script
 * parts. Everything is next/script `afterInteractive` with the request
 * nonce; 'strict-dynamic' trusts what those scripts load.
 *
 * Rendered only by the public survey page, only on the public host, and
 * only once consent allows (the caller decides). Values were re-validated
 * against the table patterns in selectPixels, and are JSON encoded here.
 */
export function Pixels({
  pixels,
  googleDefault,
  nonce,
}: {
  pixels: ResolvedPixel[]
  googleDefault: 'granted' | 'denied'
  nonce: string | undefined
}) {
  const ga4 = pixels.flatMap((p) => (p.type === 'ga4' ? [p.value] : []))
  const meta = pixels.flatMap((p) => (p.type === 'meta' ? [p.value] : []))
  const gtm = pixels.flatMap((p) => (p.type === 'gtm' ? [p.value] : []))
  const custom = pixels.flatMap((p) => (p.type === 'custom_script' ? [p] : []))
  if (pixels.length === 0) return null

  const bootstrap = `(function(w){
w.dataLayer=w.dataLayer||[];
w.gtag=w.gtag||function(){w.dataLayer.push(arguments)};
var g={ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'};
var d={ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'};
w.gtag('consent','default',${JSON.stringify(googleDefault)}==='granted'?g:d);
w.gtag('consent','update',g);
var ga=${JSON.stringify(ga4)};
if(ga.length){w.gtag('js',new Date());ga.forEach(function(id){w.gtag('config',id)});}
if(${gtm.length > 0 ? 'true' : 'false'}){w.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});}
var fb=${JSON.stringify(meta)};
if(fb.length){if(!w.fbq){var n=w.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!w._fbq)w._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];}
w.fbq('consent','grant');fb.forEach(function(id){w.fbq('init',id)});w.fbq('track','PageView');}
})(window);`

  return (
    <>
      <Script id="sv-pixels-bootstrap" strategy="afterInteractive" nonce={nonce}>
        {bootstrap}
      </Script>
      {ga4[0] ? (
        <Script
          id="sv-ga4"
          src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4[0])}`}
          strategy="afterInteractive"
          nonce={nonce}
        />
      ) : null}
      {gtm.map((id) => (
        <Script
          key={id}
          id={`sv-gtm-${id}`}
          src={`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`}
          strategy="afterInteractive"
          nonce={nonce}
        />
      ))}
      {meta.length > 0 ? (
        <Script id="sv-meta" src="https://connect.facebook.net/en_US/fbevents.js" strategy="afterInteractive" nonce={nonce} />
      ) : null}
      {custom.map((p) =>
        p.parts.map((part, i) => {
          const key = `${p.id}-${i}`
          if (part.kind === 'noscript') {
            // Only ever inside <noscript>: inert whenever scripts run.
            return <noscript key={key} dangerouslySetInnerHTML={{ __html: part.html }} />
          }
          // attrs were allow listed in parseCustomScript: async, defer, type, id, data-*.
          const { id: vendorId, ...attrs } = part.attrs
          const id = typeof vendorId === 'string' ? vendorId : `sv-custom-${key}`
          return part.src ? (
            <Script key={key} {...attrs} id={id} src={part.src} strategy="afterInteractive" nonce={nonce} />
          ) : (
            <Script key={key} {...attrs} id={id} strategy="afterInteractive" nonce={nonce}>
              {part.code}
            </Script>
          )
        }),
      )}
    </>
  )
}
