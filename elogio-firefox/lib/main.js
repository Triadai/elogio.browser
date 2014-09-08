'use strict';
var buttons = require('sdk/ui/button/action');
var pageMod = require("sdk/page-mod");
var data = require('sdk/self').data;
var tag = "img";

var panel = require("sdk/panel").Panel({
    width: 240,
    height: 400,
    contentURL: data.url('panel.html'),
    contentScriptFile: [
        data.url('deps/jquery/jquery.js'),
        data.url('deps/jquery/bootstrap.js'),
        data.url('panel-script.js')]
});


var sidebar = require("sdk/ui/sidebar").Sidebar({
    id: 'my-sidebar',
    title: 'My sidebar',
    url: require("sdk/self").data.url("panel.html")
});

var button = buttons.ActionButton({
    id: "elogio-button",
    label: "Get images",
    icon: {
        "16": "./icon-16.png",
        "32": "./icon-32.png",
        "64": "./icon-64.png"
    },
    onClick: function () {
        sidebar.show();
        panel.show({
            position: button
        });
    }
});

pageMod.PageMod({
    include: "*",
    contentScriptFile: data.url("content-script.js"),
    onAttach: function (worker) {
        worker.port.emit("getElements", tag);
        worker.port.on("gotElement", function (element) {
            //at here we do anything with element
        });
    }
});

panel.port.on("click-link", function (url) {
    console.log(url);
});