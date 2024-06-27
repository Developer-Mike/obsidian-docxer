//@ts-nocheck
import TurndownService from "turndown"

export default class ObsidianTurndown {
  static getService() {
    const service = new TurndownService({
        headingStyle: "atx",
        hr: "---",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        fence: "```",
        linkStyle: "inlined"
    })

    //#region app.js Imports
    service.remove(["script", "style", "title"]),
    service.addRule("strikethrough", {
        filter: ["del", "s"],
        replacement: function(e) {
            return "~~" + e + "~~"
        }
    }),
    service.addRule("highlight", {
        filter: ["mark"],
        replacement: function(e) {
            return "==" + e + "=="
        }
    });
    var sb = /highlight-(?:text|source)-([a-z0-9]+)/;
    service.addRule("highlightedCodeBlock", {
        filter: function(e) {
            var t = e.firstChild;
            return "DIV" === e.nodeName && sb.test(e.className) && t && "PRE" === t.nodeName
        },
        replacement: function(e, t, n) {
            var i = ((t.className || "").match(sb) || [null, ""])[1];
            return "\n\n" + n.fence + i + "\n" + t.firstChild.textContent + "\n" + n.fence + "\n\n"
        }
    }),
    service.addRule("listItem", {
        filter: "li",
        replacement: function(e, t, n) {
            e = e.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, "\n    ");
            var i = n.bulletListMarker + " "
              , r = t.parentNode;
            if ("OL" === r.nodeName) {
                var o = r.getAttr("start")
                  , a = Array.prototype.indexOf.call(r.children, t);
                i = (o ? Number(o) + a : a + 1) + ". "
            }
            return i + e + (t.nextSibling && !/\n$/.test(e) ? "\n" : "")
        }
    }),
    service.addRule("taskListItems", {
        filter: function(e) {
            return e.instanceOf(HTMLInputElement) && "checkbox" === e.type && "LI" === e.parentNode.nodeName
        },
        replacement: function(e, t) {
            return t.checked ? "[x] " : "[ ] "
        }
    }),
    service.addRule("tableCell", {
        filter: ["th", "td"],
        replacement: function(e, t) {
            return (0 === Array.prototype.indexOf.call(t.parentNode.childNodes, t) ? "|" : "") + function(e) {
                return (e = e.trim().replace(/\|+/g, "\\|").replace(/\n\r?/g, "<br>")) + "|"
            }(e) + hb(t, "   |")
        }
    });
    var lb = {
        left: ":--",
        right: "--:",
        center: ":-:"
    };
    function cb(e) {
        if (!e)
            return !1;
        var t, n, i = e.parentNode;
        return "THEAD" === i.nodeName || i.firstChild === e && ("TABLE" === i.nodeName || (n = (t = i).previousSibling,
        "TBODY" === t.nodeName && (!n || "THEAD" === n.nodeName && /^\s*$/i.test(n.textContent)))) && Array.prototype.every.call(e.childNodes, (function(e) {
            return "TH" === e.nodeName
        }
        ))
    }
    function ub(e) {
        var t = e.getAttribute("colspan");
        if (!t)
            return 0;
        var n = parseInt(t);
        return isNaN(n) ? 0 : Math.max(0, n - 1)
    }
    function hb(e, t) {
        return t.repeat(ub(e))
    }
    function pb(e) {
        return service.turndown(e)
    }
    service.addRule("tableRow", {
        filter: "tr",
        replacement: function(e, t) {
            var n = "";
            if (cb(t))
                for (var i = 0; i < t.cells.length; i++) {
                    var r = t.cells[i]
                      , o = (r.getAttribute("align") || "").toLowerCase()
                      , a = lb[o] || "---";
                    n += (0 === i ? "|" : "") + a + "|" + hb(r, a + "|")
                }
            return "\n" + e + (n ? "\n" + n : "")
        }
    }),
    service.addRule("table", {
        filter: "table",
        replacement: function(e, t) {
            var n = t.rows[0];
            if (!cb(n)) {
                for (var i = n.cells.length, r = 0; r < n.cells.length; r++)
                    i += ub(n.cells[r]);
                e = "|" + "   |".repeat(i) + "\n|" + "---|".repeat(i) + "\n" + e.replace(/^[\r\n]+/, "")
            }
            return "\n\n" + (e = e.replace(/[\r\n]+/g, "\n")) + "\n\n"
        }
    }),
    service.addRule("tableSection", {
        filter: ["thead", "tbody", "tfoot"],
        replacement: function(e) {
            return e
        }
    }),
    service.escape = function(e) {
        return e
    }
    //#endregion

    return service
  }
}