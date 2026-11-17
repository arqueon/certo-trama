// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'

// Single source of truth for the self-hosted site's public URL. Previously
// only read via raw import.meta.env/process.env in app/constants/index.ts,
// which is never wired into a Nuxt-managed env exposure mechanism, so it
// silently stayed on the production default in every self-hosted build no
// matter what env var was set (see docs/known-issues-and-dev-notes.md).
// Wiring it through runtimeConfig.public (like apiUrl already is) is what
// actually makes it configurable.
const websiteUrl = process.env.NUXT_PUBLIC_WEBSITE_URL || 'https://certo.schroedinger-hat.org'

export default defineNuxtConfig({
  routeRules: { '/credentials/**': { headers: { 'cache-control': 'private, no-store' } } },
  compatibilityDate: '2025-06-12',
  devtools: { enabled: true },
  modules: [
    '@nuxt/test-utils/module',
    '@nuxtjs/color-mode',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@una-ui/nuxt',
    '@unocss/nuxt',
    'nuxt-svgo',
    '@nuxt/image',
    '@nuxt/icon',
    ['nuxt-gtag', {
      id: process.env.NUXT_PUBLIC_GA4_ID || '', // No ID = no analytics sent
      config: {
        anonymize_ip: true,
        send_page_view: true
      },
      debug: false
    }],
    ['@nuxtjs/sitemap', {
      hostname: websiteUrl,
      gzip: true,
      trailingSlash: false,
      // Only include public routes. Authenticated dashboards and admin flows
      // should not be presented as indexable content.
      staticRoutes: [
        '/',
        '/about',
        '/get-started',
        '/verify',
        '/privacy-policy',
        '/terms-and-conditions',
      ],
      // Dynamic credential pages fetched from the public verify endpoint
      // Each public credential URL is independently indexable
      routes: async () => {
        try {
          const apiUrl = process.env['NUXT_PUBLIC_API_URL'] || 'http://localhost:1337'
          const res = await fetch(`${apiUrl}/api/credentials?fields[0]=credentialId&pagination[pageSize]=1000`)
          if (!res.ok) return []
          const data = await res.json() as { data?: Array<{ credentialId?: string }> }
          return (data.data ?? [])
            .filter((c) => c.credentialId)
            .map((c) => `/credentials/${encodeURIComponent(c.credentialId!)}`)
        } catch {
          return []
        }
      },
    }],
  ],
  svgo: {
    autoImportPath: './assets/svg/'
  },
  colorMode: {
    preference: 'light',
    fallback: 'light',
  },
  icon: {
    serverBundle: {
      collections: ['heroicons', 'lucide', 'radix-icons', 'simple-icons', 'tabler']
    }
  },
  unocss: {
    // UnoCSS configuration
    preflight: true,
    icons: {
      scale: 1.2,
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    },
    safelist: [
      // Simple Icons for sponsors
      'i-simple-icons-slack',
      'i-simple-icons-netflix',
      'i-simple-icons-fitbit',
      'i-simple-icons-google',
      'i-simple-icons-airbnb',
      'i-simple-icons-uber',
    ]
  },
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'manifest', href: '/site.webmanifest' },

        { rel: 'sitemap', type: 'application/xml', href: '/sitemap.xml' },
        { rel: 'describedby', type: 'text/plain', href: '/llms.txt' },

        { rel: 'canonical', href: websiteUrl },
        // Space Grotesk (Google Fonts) se añade en app.vue salvo que
        // NUXT_PUBLIC_EXTERNAL_FONTS=false: una instancia puede no querer
        // que cada visita consulte a un tercero.
      ],
      script: [
        {
          type: 'application/ld+json',
          children: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            'name': 'Certo',
            'description': 'Open-source platform for issuing, managing, and verifying digital credentials based on Open Badges 3.0 and W3C Verifiable Credentials.',
            'url': websiteUrl,
            'applicationCategory': 'BusinessApplication',
            'operatingSystem': 'Linux, macOS, Windows',
            'isAccessibleForFree': true,
            'license': 'https://www.gnu.org/licenses/agpl-3.0.html',
            // Apunta a nuestro fork, no al proyecto original -- AGPL-3.0
            // §13 exige ofrecer el código fuente de la versión que
            // realmente corre aquí, con nuestros parches.
            'codeRepository': 'https://github.com/arqueon/certo',
            'author': {
              '@type': 'Organization',
              'name': 'Schroedinger Hat',
              'url': 'https://github.com/Schroedinger-Hat',
            },
            'featureList': [
              'Digital credential issuance',
              'Open Badges 3.0 verification',
              'W3C Verifiable Credentials',
              'Credential revocation',
              'Self-hosted Docker and Kubernetes deployment',
            ],
          }),
        },
      ],
      htmlAttrs: {
        // lang is updated dynamically per-request in app.vue via useHead()
        lang: process.env.NUXT_PUBLIC_DEFAULT_LOCALE || 'en'
      }
    }
  },
  runtimeConfig: {
    issuerDidBackendUrl: '',
    // Base del catálogo de la consola para «Para seguir aprendiendo», leída
    // desde el servidor (NUXT_CATALOG_API_URL; en la VM, la red interna). Sin
    // ella se usa el origen de NUXT_PUBLIC_CATALOG_URL.
    catalogApiUrl: '',
    public: {
      apiUrl: process.env.NUXT_PUBLIC_API_URL,
      walletAppUrl: process.env.NUXT_PUBLIC_WALLET_APP_URL || '',
      walletAppName: process.env.NUXT_PUBLIC_WALLET_APP_NAME || 'Cartera',
      // Public visibility switch only; backend authorization remains independent.
      portalTitularEnabled: false,
      websiteUrl,
      brandName: process.env.NUXT_PUBLIC_BRAND_NAME || '',
      // Organización sobre el título de la portada (p. ej. la institución); vacía, no se muestra.
      brandOrganization: process.env.NUXT_PUBLIC_BRAND_ORGANIZATION || '',
      brandLogoUrl: process.env.NUXT_PUBLIC_BRAND_LOGO_URL || '',
      // Logotipo para fondos oscuros (encabezado azul, pie en modo oscuro) y
      // emblema para la medalla de la portada. Vacíos: se usa brandLogoUrl
      // (en fondo oscuro, convertido a silueta blanca con un filtro).
      brandLogoInverseUrl: process.env.NUXT_PUBLIC_BRAND_LOGO_INVERSE_URL || '',
      brandEmblemUrl: process.env.NUXT_PUBLIC_BRAND_EMBLEM_URL || '',
      brandPrimaryColor: process.env.NUXT_PUBLIC_BRAND_PRIMARY_COLOR || '',
      // Organization this instance is a service of, shown in the footer as
      // "A service of <name>". Empty name: the line is not shown. The logo is
      // a same-origin path ("/marca/…") or https; the URL, http(s).
      brandParentName: process.env.NUXT_PUBLIC_BRAND_PARENT_NAME || '',
      brandParentLogoUrl: process.env.NUXT_PUBLIC_BRAND_PARENT_LOGO_URL || '',
      brandParentUrl: process.env.NUXT_PUBLIC_BRAND_PARENT_URL || '',
      // Hoja de estilo de la instancia, cargada después de los tokens: redefine
      // las variables --mc-* (colores, fuentes, radios) sin recompilar.
      // Solo rutas del mismo origen («/marca/…») o https.
      brandStylesheetUrl: process.env.NUXT_PUBLIC_BRAND_STYLESHEET_URL || '',
      // 'false' quita la carga de Space Grotesk desde Google Fonts.
      externalFonts: process.env.NUXT_PUBLIC_EXTERNAL_FONTS || 'true',
      // Comma-separated users-permissions provider names to offer on the
      // login page. Read through runtimeConfig, not import.meta.env, so it
      // stays configurable at container runtime (same bug as WEBSITE_URL had).
      oauthProviders: process.env.NUXT_PUBLIC_OAUTH_PROVIDERS || '',
      // Interface locale when the visitor has not chosen one (certo_locale
      // cookie). Defaults to English, as upstream.
      catalogUrl: process.env.NUXT_PUBLIC_CATALOG_URL || '',
      // Configuración de la cuenta institucional (p. ej. la consola de cuenta de
      // Keycloak): el perfil enlaza ahí para corregir nombre o correo.
      accountUrl: process.env.NUXT_PUBLIC_ACCOUNT_URL || '',
      defaultLocale: process.env.NUXT_PUBLIC_DEFAULT_LOCALE || '',
      // 'false' to skip browser-language detection on first visit.
      detectBrowserLocale: process.env.NUXT_PUBLIC_DETECT_BROWSER_LOCALE || '',
    }
  },
  imports: {
    dirs: ['stores', 'constants'],
  },
  css: [
    '~/assets/css/main.css',
    '~/assets/css/udg-tokens.css',
    '~/assets/css/udg-componentes.css',
  ],
  plugins: [
    '~/plugins/api.ts',
    '~/plugins/auth.ts',
    // The auth-init plugin is client-only and will be auto-imported
    '~/plugins/i18n.client.ts',
  ],
})
