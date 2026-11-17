/**
 * Configuración global de planes (Versión preliminar: TODO GRATIS).
 * Para volver a activar el candado Pro y el pago simulado, cambia `PRO_GRATIS` a `false`.
 */
export const PRO_GRATIS = true;

export function tieneAccesoPro(perfil) {
  return PRO_GRATIS || perfil?.plan === 'pro';
}
