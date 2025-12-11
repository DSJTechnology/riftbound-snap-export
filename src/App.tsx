import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CardDatabaseProvider } from "@/contexts/CardDatabaseContext";
import { CardHashProvider } from "@/contexts/CardHashContext";
import { CardEmbeddingProvider } from "@/contexts/CardEmbeddingContext";
import Index from "./pages/Index";
import Training from "./pages/Training";
import SanityTests from "./pages/SanityTests";
import EmbeddingAdmin from "./pages/EmbeddingAdmin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <CardDatabaseProvider>
      <CardHashProvider>
        <CardEmbeddingProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/training" element={<Training />} />
                <Route path="/sanity-tests" element={<SanityTests />} />
                <Route path="/embedding-admin" element={<EmbeddingAdmin />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </CardEmbeddingProvider>
      </CardHashProvider>
    </CardDatabaseProvider>
  </QueryClientProvider>
);

export default App;
