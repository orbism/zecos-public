import type { Metadata } from 'next';
import PayView from './PayView';

/** Public Pay Me page: `/pay/<handle>`. Data loads in the browser (see PayView). */
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const name = decodeURIComponent(handle).slice(0, 40);
  return { title: `Pay ${name} in ZEC`, description: `Send ${name} Zcash directly, with an optional private note. A ZEC-OS Pay Me page.` };
}

export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <PayView handle={decodeURIComponent(handle)} />;
}
