/**
 * A club badge.
 *
 * Deliberately not next/image: the crests come from the provider's CDN,
 * which would need whitelisting in the image config, and at this size the
 * optimiser has nothing to win. `crossOrigin` is set so the browser caches
 * one copy that the share card's canvas can also use without tainting it.
 */
export function Crest({
  url,
  alt = '',
  className = 'h-5 w-5',
}: {
  url: string | null | undefined;
  alt?: string;
  className?: string;
}) {
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      crossOrigin="anonymous"
      loading="lazy"
      className={`${className} shrink-0 object-contain`}
    />
  );
}
