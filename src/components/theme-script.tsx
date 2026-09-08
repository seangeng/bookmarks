/**
 * Applies the theme before first paint so there is no flash.
 *
 * The library is designed dark-first, so dark is the default regardless of the
 * system preference; the header toggle stores an explicit choice that wins.
 */
const script = `(function(){var d=true;try{d=localStorage.getItem("theme")!=="light";}catch(e){}document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
