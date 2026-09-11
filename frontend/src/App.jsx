import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Library from "./components/Library";
import Home from "./components/Home";
import SectionPage from "./components/SectionPage";
import GlossaryPage from "./components/GlossaryPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/:bookSlug" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="sections/:id" element={<SectionPage />} />
        <Route path="glossary" element={<GlossaryPage />} />
      </Route>
    </Routes>
  );
}
