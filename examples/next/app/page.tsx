import { T } from "@/components/cmsbar/T";
import { EditableImage } from "@/components/cmsbar/EditableImage";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <T as="h1" path="demo.title" />
      <T as="p" path="demo.intro" />
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1200 / 630",
          marginTop: 24,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <EditableImage
          path="demo.image"
          alt="CMSBar demo"
          fill
          sizes="(max-width: 760px) 100vw, 760px"
        />
      </div>
    </main>
  );
}
