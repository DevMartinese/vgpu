import { MobileDocsBar } from "@vercel/geistdocs/mobile-docs-bar";
import { createDocsPage } from "@vercel/geistdocs/pages/docs";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { config } from "@/lib/geistdocs/config";
import { geistdocsSource } from "@/lib/geistdocs/source";
import { titleAnchorId } from "@/lib/title-anchor.mjs";

const docsPage = createDocsPage({
  config,
  // `link` can be `undefined`; only pass an `a` override when the package
  // actually provides one, otherwise `{ a: undefined }` fails MDXComponents'
  // type (it disallows `undefined` values, only `NestedMDXComponents |
  // Component<any>`). Real bug in the vanilla 1.15.2 template, fixed here in
  // this user-owned adapter file rather than patched in the package.
  mdx: ({ link }) => getMDXComponents(link ? { a: link } : undefined),
  openGraph: {
    images: true,
  },
  source: geistdocsSource,
  tableOfContentPopover: {
    enabled: false,
  },
  // ANCHOR TGEIST-12 / Decision 2.3 — the page-title anchor.
  //
  // The old site's `<h1>` came from the markdown body, so `/docs/cli#cli` had a
  // real target: 97 anchors frozen from prod are exactly that, and so are most of
  // the `#anchor` destinations of the API reference redirects (a single-symbol
  // topic's heading *is* the page title). `createDocsPage` renders the title
  // itself and takes no props for it, so the id goes on a zero-height element
  // here — `renderTop`'s output is the page's first child and the title div the
  // second, so this is the same scroll target the `<h1>` would have been.
  // `titleAnchorId` returns null when a body heading already owns that id (the
  // reference pages open every symbol with an `<h1>`), because two identical ids
  // in one document would shadow the real heading.
  renderTop: ({ data }) => {
    const anchor = titleAnchorId({ title: data.title, toc: data.toc });
    return (
      <>
        {anchor ? <span aria-hidden="true" className="block h-0" id={anchor} /> : null}
        <MobileDocsBar toc={data.toc} />
      </>
    );
  },
});

export default docsPage.Page;
export const generateStaticParams = docsPage.generateStaticParams;
export const generateMetadata = docsPage.generateMetadata;
