import { useEffect, useState } from "react";

export function navigate(url) {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useLocation() {
  const read = () => ({ path: window.location.pathname, search: window.location.search });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const onPop = () => setLoc(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return loc;
}

export function linkTo(url) {
  return {
    href: url,
    onClick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(url);
    },
  };
}
