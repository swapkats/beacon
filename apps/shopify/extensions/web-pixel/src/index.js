"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var collector_1 = require("@beacon/collector");
var web_pixels_extension_1 = require("@shopify/web-pixels-extension");
(0, web_pixels_extension_1.register)(function (_a) {
    var _b, _c;
    var analytics = _a.analytics, browser = _a.browser, settings = _a.settings;
    var ingestUrl = String((_b = settings.ingestUrl) !== null && _b !== void 0 ? _b : "");
    var storeToken = String((_c = settings.storeToken) !== null && _c !== void 0 ? _c : "");
    if (!ingestUrl || !storeToken)
        return;
    var storage = {
        get: function (key) {
            var _a;
            try {
                return (_a = browser.cookie.get(key)) !== null && _a !== void 0 ? _a : null;
            }
            catch (_b) {
                return null;
            }
        },
        set: function (key, value, maxAgeSeconds) {
            try {
                browser.cookie.set(key, value, { path: "/", maxage: maxAgeSeconds });
            }
            catch (_a) {
                try {
                    browser.cookie.set(key, value);
                }
                catch (_b) {
                    return;
                }
            }
        },
    };
    var collector = (0, collector_1.initCollector)({
        endpoint: ingestUrl,
        storeToken: storeToken,
        storage: storage,
    });
    var href = function (event) { var _a, _b, _c, _d; return (_d = (_c = (_b = (_a = event.context) === null || _a === void 0 ? void 0 : _a.document) === null || _b === void 0 ? void 0 : _b.location) === null || _c === void 0 ? void 0 : _c.href) !== null && _d !== void 0 ? _d : null; };
    var referrerOf = function (event) { var _a, _b, _c; return (_c = (_b = (_a = event.context) === null || _a === void 0 ? void 0 : _a.document) === null || _b === void 0 ? void 0 : _b.referrer) !== null && _c !== void 0 ? _c : null; };
    var toId = function (value) {
        return typeof value === "string" ? value.replace(/^gid:\/\/shopify\/\w+\//, "") : null;
    };
    analytics.subscribe("page_viewed", function (event) {
        collector.track({
            type: "page.viewed",
            clientId: event.clientId,
            path: href(event),
            referrer: referrerOf(event),
        });
    });
    analytics.subscribe("product_viewed", function (event) {
        var _a, _b, _c, _d, _e, _f;
        var variant = (_a = event.data) === null || _a === void 0 ? void 0 : _a.productVariant;
        var product = variant === null || variant === void 0 ? void 0 : variant.product;
        collector.track({
            type: "product.viewed",
            clientId: event.clientId,
            productId: toId(product === null || product === void 0 ? void 0 : product.id),
            variantId: toId(variant === null || variant === void 0 ? void 0 : variant.id),
            title: (_b = product === null || product === void 0 ? void 0 : product.title) !== null && _b !== void 0 ? _b : null,
            price: (_d = (_c = variant === null || variant === void 0 ? void 0 : variant.price) === null || _c === void 0 ? void 0 : _c.amount) !== null && _d !== void 0 ? _d : null,
            currency: (_f = (_e = variant === null || variant === void 0 ? void 0 : variant.price) === null || _e === void 0 ? void 0 : _e.currencyCode) !== null && _f !== void 0 ? _f : null,
            path: href(event),
        });
    });
    analytics.subscribe("product_added_to_cart", function (event) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        var line = (_a = event.data) === null || _a === void 0 ? void 0 : _a.cartLine;
        var merch = line === null || line === void 0 ? void 0 : line.merchandise;
        collector.track({
            type: "cart.added",
            clientId: event.clientId,
            productId: toId((_b = merch === null || merch === void 0 ? void 0 : merch.product) === null || _b === void 0 ? void 0 : _b.id),
            variantId: toId(merch === null || merch === void 0 ? void 0 : merch.id),
            title: (_d = (_c = merch === null || merch === void 0 ? void 0 : merch.product) === null || _c === void 0 ? void 0 : _c.title) !== null && _d !== void 0 ? _d : null,
            price: (_f = (_e = merch === null || merch === void 0 ? void 0 : merch.price) === null || _e === void 0 ? void 0 : _e.amount) !== null && _f !== void 0 ? _f : null,
            currency: (_h = (_g = merch === null || merch === void 0 ? void 0 : merch.price) === null || _g === void 0 ? void 0 : _g.currencyCode) !== null && _h !== void 0 ? _h : null,
            quantity: (_j = line === null || line === void 0 ? void 0 : line.quantity) !== null && _j !== void 0 ? _j : null,
            path: href(event),
        });
    });
    analytics.subscribe("checkout_started", function (event) {
        collector.track({
            type: "checkout.started",
            clientId: event.clientId,
            path: href(event),
        });
    });
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "hidden")
                collector.flush();
        });
    }
});
