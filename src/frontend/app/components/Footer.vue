<script setup lang="ts">
import { useMounted } from '@vueuse/core'

const branding = useBranding()
// La sesión solo existe en el cliente: leerla al montar evita el desajuste de hidratación.
const mounted = useMounted()
const { t } = useI18n()
const authStore = useAuthStore()
</script>

<template>
  <footer class="w-full pt-16 pb-8" :class="branding.active ? 'mc-pie' : 'bg-gradient-to-b from-white to-[#FFE5AE]/20'">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
        <!-- Logo Column -->
        <div>
          <div class="flex items-center gap-3">
            <span v-if="branding.active && branding.logoUrl === '/certo-logo-text.png'" class="text-2xl font-bold">{{ branding.name }}</span>
            <template v-else>
              <img :src="branding.logoUrl" :alt="`${branding.name} logo`" class="h-14 w-auto" :class="{ 'mc-pie__logo-claro': branding.logoInverseUrl }">
              <img v-if="branding.logoInverseUrl" :src="branding.logoInverseUrl" :alt="`${branding.name} logo`" class="h-14 w-auto mc-pie__logo-oscuro">
            </template>
          </div>
          <p class="mt-4 text-text-secondary max-w-sm">
            {{ t('footer.description') }}
          </p>
        </div>

        <!-- Quick Links -->
        <div class="space-y-4">
          <h3 class="font-bold text-lg">
            {{ t('footer.linksTitle') }}
          </h3>
          <ul class="space-y-2">
            <li>
              <NuxtLink
                to="/"
                class="text-text-secondary hover:text-text-primary transition-colors"
              >
                {{ t('footer.links.home') }}
              </NuxtLink>
            </li>
            <li v-if="!branding.active || (mounted && authStore.isAuthenticated)">
              <NuxtLink
                to="/dashboard"
                class="text-text-secondary hover:text-text-primary transition-colors"
              >
                {{ t('footer.links.dashboard') }}
              </NuxtLink>
            </li>
            <li>
              <NuxtLink
                to="/verify"
                class="text-text-secondary hover:text-text-primary transition-colors"
              >
                {{ t('footer.links.verify') }}
              </NuxtLink>
            </li>
            <li>
              <NuxtLink
                to="/linkedin"
                class="text-text-secondary hover:text-text-primary transition-colors"
              >
                {{ t('footer.links.linkedin') }}
              </NuxtLink>
            </li>
          </ul>
        </div>

        <!-- Legal -->
        <div class="space-y-4">
          <h3 class="font-bold text-lg">
            {{ t('footer.legal') }}
          </h3>
          <ul class="space-y-2">
            <li>
              <a
                href="/privacy-policy"
                class="text-text-secondary hover:text-text-primary transition-colors"
              >
                {{ t('footer.links.privacyNotice') }}
              </a>
            </li>
            <li>
              <a
                href="/terms-and-conditions"
                class="text-text-secondary hover:text-text-primary transition-colors"
              >
                {{ t('footer.links.termsConditions') }}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <!-- Copyright -->
      <div class="text-center text-text-secondary pt-8 border-t border-gray-200">
        <p>{{ branding.name }} © {{ new Date().getFullYear() }}.</p>
        <p v-if="branding.parent" class="mt-2 inline-flex items-center gap-2">
          <span>{{ t('footer.serviceOf') }}</span>
          <component
            :is="branding.parent.url ? 'a' : 'span'"
            :href="branding.parent.url || undefined"
            class="inline-flex items-center gap-1.5 font-bold"
            :class="{ 'underline hover:text-text-primary': branding.parent.url }"
          >
            <img v-if="branding.parent.logoUrl" :src="branding.parent.logoUrl" alt="" class="h-5 w-5">
            {{ branding.parent.name }}
          </component>
        </p>
        <p class="text-xs mt-1">
          {{ t('footer.builtOn') }}
          <a
            href="https://github.com/arqueon/certo"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:text-text-primary"
          >Certo</a>
          {{ t('footer.license') }}
          <a
            href="https://github.com/arqueon/certo"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:text-text-primary"
          >{{ t('footer.sourceCode') }}</a>
        </p>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.mc-pie { background: var(--mc-superficie); border-top: 1px solid var(--mc-linea); }
.mc-pie :is(p, a, li) { color: var(--mc-suave); }
.mc-pie h3 { font-family: var(--mc-fuente-titulos); color: var(--mc-texto); }
.mc-pie a:hover { color: var(--mc-texto); }
.mc-pie .border-t { border-color: var(--mc-linea); }
</style>
