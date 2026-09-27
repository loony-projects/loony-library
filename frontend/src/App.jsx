import { AccountProvider } from "./components/Account";
import { PreferencesProvider } from "./components/Preferences";
import { TooltipProvider } from "./components/ui/tooltip";
import AuthorPage from "./components/AuthorPage";
import ChapterPrint from "./components/ChapterPrint";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Library from "./components/Library";
import Home from "./components/Home";
import SectionPage from "./components/SectionPage";
import GlossaryPage from "./components/GlossaryPage";

export default function App() {
  return (
    <PreferencesProvider>
      <AccountProvider>
        <TooltipProvider>
          <Routes>
            <Route path="/authors/:authorId" element={<AuthorPage />} />
            <Route path="/:bookSlug/print/:chapterId" element={<ChapterPrint />} />
            <Route path="/" element={<Library />} />
            <Route path="/:bookSlug" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="sections/:id" element={<SectionPage />} />
              <Route path="glossary" element={<GlossaryPage />} />
            </Route>
          </Routes>
        </TooltipProvider>
      </AccountProvider>
    </PreferencesProvider>
  );
}
