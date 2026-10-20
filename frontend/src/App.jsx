import Admin from "./admin/Admin.jsx";

export default function App() {
  if (window.location.pathname.startsWith("/admin")) return <Admin />;
  return (
    <main>
      <h1>probooks</h1>
      <p>The shop opens soon.</p>
    </main>
  );
}
