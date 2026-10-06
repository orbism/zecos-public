// Standalone routes always render in an Obsidian variant, regardless of the
// visitor's saved desktop theme. The root layout's init script applies that
// saved theme before hydration, so this nested script runs after it and
// overrides the attribute - the static :root[data-theme="obsidian…"] blocks in
// globals.css then paint the correct palette immediately, with no flash.
// useStandaloneTheme later applies the full theme object (and restores the
// previous values on unmount, so navigating back to `/` is unaffected).
const forceObsidian = `
(function() {
  try {
    var m = localStorage.getItem('zec-os-standalone-theme') === 'light' ? 'obsidian-light' : 'obsidian';
    document.documentElement.setAttribute('data-theme', m);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'obsidian');
  }
})();
`;

export default function StandaloneLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: forceObsidian }} />
      {children}
    </>
  );
}
