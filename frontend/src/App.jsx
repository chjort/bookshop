import Admin from "./admin/Admin.jsx";
import Shop from "./shop/Shop.jsx";
import "./shop.css";

export default function App() {
  if (window.location.pathname.startsWith("/admin")) return <Admin />;
  return <Shop />;
}
