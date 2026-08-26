import { HomePage } from "./home-page";

export { homeMetadata as metadata } from "./home-metadata";

export default function HiddenHeroHomePage() {
  return <HomePage heroCanvasEnabled={false} />;
}
