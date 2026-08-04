import { MobileDocsBar } from "@vercel/geistdocs/mobile-docs-bar";
import { createDocsPage } from "@vercel/geistdocs/pages/docs";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { config } from "@/lib/geistdocs/config";
import { geistdocsSource } from "@/lib/geistdocs/source";

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
  renderTop: ({ data }) => <MobileDocsBar toc={data.toc} />,
});

export default docsPage.Page;
export const generateStaticParams = docsPage.generateStaticParams;
export const generateMetadata = docsPage.generateMetadata;
