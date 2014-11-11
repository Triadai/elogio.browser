'use strict';
var Elogio = require('./common-chrome-lib.js').Elogio;

new Elogio(['config', 'bridge', 'utils', 'elogioRequest', 'elogioServer'], function (modules) {
    // FF modules
    var _ = require('sdk/l10n').get,
        buttons = require('sdk/ui/button/action'),
        pageMod = require("sdk/page-mod"),
        self = require('sdk/self'),
        tabs = require('sdk/tabs'),
        simplePrefs = require("sdk/simple-prefs"),
        Sidebar = require("sdk/ui/sidebar").Sidebar,
        clipboard = require("sdk/clipboard"),
        errorIndicator = self.data.url("img/error.png"),
        elogioIcon = self.data.url("img/icon-72.png"),
        elogioDisableIcon = self.data.url("img/icon-72-disabled.png"),
        contextMenu = require("sdk/context-menu");
    // Elogio Modules
    var bridge = modules.getModule('bridge'),
        elogioServer = modules.getModule('elogioServer'),
        config = modules.getModule('config'),
        utils = modules.getModule('utils');
    var elogioSidebar, sidebarIsHidden = true, scrollToImageCard = null, currentTab,
        appState = new Elogio.ApplicationStateController(),
        pluginState = {
            isEnabled: false
        };

    /*
     =======================
     PRIVATE MEMBERS
     =======================
     */

    /**
     * This method needs to send request to elogio server, and sends to panel imageObj with or without lookup data;
     * @param lookupImageObjStorage - it's imageObj storage for lookup request
     * @param contentWorker
     */
    function lookupQuery(lookupImageObjStorage, contentWorker) {
        var localStore = lookupImageObjStorage,
            dictionary = {uri: []},
            tabState = appState.getTabState(contentWorker.tab.id);
        //create dictionary
        for (var i = 0; i < localStore.length; i++) {
            dictionary.uri.push(localStore[i].uri);
        }
        elogioServer.lookupQuery(dictionary,
            function (lookupJson) {
                for (var i = 0; i < localStore.length; i++) {
                    var existsInResponse = false,
                        imageFromStorage = tabState.findImageInStorageByUuid(localStore[i].uuid);
                    // If image doesn't exist in local storage anymore - there is no sense to process it
                    if (!imageFromStorage) {
                        continue;
                    }
                    // Find image from our query in JSON.
                    for (var j = 0; j < lookupJson.length; j++) {
                        if (imageFromStorage.uri === lookupJson[j].uri) {
                            if (existsInResponse) {// if we found first lookup json object then cancel loop
                                break;
                            }
                            existsInResponse = true;
                            // Extend data ImageObject with lookup data and save it
                            imageFromStorage.lookup = lookupJson[j];
                            bridge.emit(bridge.events.newImageFound, imageFromStorage);
                            contentWorker.port.emit(bridge.events.newImageFound, imageFromStorage);
                        }
                    }
                    // If it doesn't exist - assume it doesn't exist on server
                    if (!existsInResponse) {
                        imageFromStorage.lookup = false;
                        bridge.emit(bridge.events.newImageFound, imageFromStorage);
                    }
                }
            },
            function (response) {
                for (var i = 0; i < localStore.length; i++) {
                    var imageFromStorage = tabState.findImageInStorageByUuid(localStore[i].uuid);
                    // If image doesn't exist in local storage anymore - there is no sense to process it
                    if (!imageFromStorage) {
                        continue;
                    }
                    imageFromStorage.error = getTextStatusByStatusCode(response.status);
                    indicateError(imageFromStorage);
                }
            }
        );
    }

    function getTextStatusByStatusCode(statusCode) {
        switch (statusCode) {
            case 200:
                return _('requestError_01');
            case 0:
                return _('requestError_02');
            default:
                return _('requestError_03');
        }
    }

    /**
     * This method needs to register all listeners of sidebar
     * @param bridge - it's a worker.port of sidebar
     */
    function registerSidebarEventListeners(bridge) {
        bridge.on(bridge.events.onImageAction, function (uuid) {
            var tabState = appState.getTabState(tabs.activeTab.id),
                contentWorker = tabState.getWorker();
            if (contentWorker) {
                contentWorker.port.emit(bridge.events.onImageAction, uuid);
            }
        });
        bridge.on(bridge.events.copyToClipBoard, function (request) {
            var clipboardData = request.data;
            clipboard.set(clipboardData, request.type);
        });
        bridge.on(bridge.events.oembedRequestRequired, function (imageObj) {
            var oembedEndpoint = utils.getOembedEndpointForImageUri(imageObj.uri),
                tabState = appState.getTabState(tabs.activeTab.id),
                contentWorker = tabState.getWorker();
            if (oembedEndpoint) {
                elogioServer.oembedLookup(oembedEndpoint, imageObj.uri, function (oembedJSON) {
                    var imageObjFromStorage = tabState
                        .findImageInStorageByUuid(imageObj.uuid);
                    if (imageObjFromStorage) {
                        imageObjFromStorage.lookup = true;
                        delete imageObjFromStorage.error;//if error already exist in this image then delete it
                        imageObjFromStorage.details = utils.oembedJsonToElogioJson(oembedJSON);
                        indicateError();
                        //sending details
                        bridge.emit(bridge.events.imageDetailsReceived, imageObjFromStorage);
                    } else {
                        console.log("Can't find image in storage: " + imageObj.uuid);
                    }
                }, function () {
                    //on error we need calculate hash
                    contentWorker.port.emit(bridge.events.hashRequired, imageObj);
                });
            } else {
                //if this image doesn't match for oembed then calculate hash
                contentWorker.port.emit(bridge.events.hashRequired, imageObj);
            }
        });
        // Proxy startPageProcessing signal to content script
        bridge.on(bridge.events.startPageProcessing, function () {
            var tabState = appState.getTabState(tabs.activeTab.id),
                contentWorker = tabState.getWorker();
            tabState.clearImageStorage();
            tabState.clearLookupImageStorage();
            if (contentWorker) {
                indicateError();//when page processing started we turn off error indicator
                //at first we need to tell content script about state of plugin
                notifyPluginState(contentWorker.port);
                contentWorker.port.emit(bridge.events.startPageProcessing);
            }
        });
        // When plugin is turned on we need to update state and notify content script
        bridge.on(bridge.events.pluginActivated, function () {
            var tabState = appState.getTabState(tabs.activeTab.id),
                contentWorker = tabState.getWorker();
            if (!pluginState.isEnabled) {
                pluginState.isEnabled = true;
                tabState.clearImageStorage();
                tabState.clearLookupImageStorage();//cleanup and initialize uri storage before start
                notifyPluginState(bridge);
                if (contentWorker) {
                    contentWorker.port.emit(bridge.events.configUpdated, config);
                    notifyPluginState(contentWorker.port);
                    bridge.emit(bridge.events.startPageProcessing);
                }
            }
        });
        // When plugin is turned off we need to update state and notify content script
        bridge.on(bridge.events.pluginStopped, function () {
            var tabState = appState.getTabState(tabs.activeTab.id),
                contentWorker = tabState.getWorker();
            var tabStates, i;
            if (pluginState.isEnabled) {
                pluginState.isEnabled = false;
                // Cleanup local storage
                tabStates = appState.getAllTabState();
                if (tabStates) {
                    for (i = 0; i < tabStates.length; i += 1) {
                        tabStates[i].clearImageStorage();
                        tabStates[i].clearLookupImageStorage();
                    }
                }
                if (contentWorker) {
                    notifyPluginState(contentWorker.port);
                }
                notifyPluginState(bridge);
            }
            indicateError();//and if tab has errors, then we turn off indicator with errors because plugin stopped
        });
        // When panel requires image details from server - perform request and notify panel on result
        bridge.on(bridge.events.imageDetailsRequired, function (imageObj) {
            var tabState = appState.getTabState(tabs.activeTab.id);
            elogioServer.annotationsQuery(imageObj.lookup.href,
                function (annotationsJson) {
                    var imageObjFromStorage = tabState
                        .findImageInStorageByUuid(imageObj.uuid);
                    if (imageObjFromStorage) {
                        imageObjFromStorage.details = annotationsJson;
                        delete imageObjFromStorage.error;//if error already exist in this image then delete it
                        indicateError();
                        bridge.emit(bridge.events.imageDetailsReceived, imageObjFromStorage);
                    } else {
                        console.log("Can't find image in storage: " + imageObj.uuid);
                    }
                },
                function (response) {
                    //put error to storage
                    imageObj.error = getTextStatusByStatusCode(response.status);
                    indicateError(imageObj);
                },
                config.global.apiServer.urlLookupOptions
            );
        });
    }

    function toggleSidebar() {
        if (!sidebarIsHidden) {
            button.icon = elogioDisableIcon;
            button.label = _('pluginStateOff');
            elogioSidebar.hide();
        } else {
            button.icon = elogioIcon;
            button.label = _('pluginStateOn');
            elogioSidebar.show();
        }
    }

    function notifyPluginState(destination) {
        if (pluginState.isEnabled) {
            destination.emit(bridge.events.pluginActivated);
        } else {
            destination.emit(bridge.events.pluginStopped);
        }
    }

    /**
     * toggle icon and label of action button, also send image with error message in.
     * if this method calls without params then error indicator disappear from button
     * @param imageObj - image which contains error message
     */
    function indicateError(imageObj) {
        var tabState = appState.getTabState(tabs.activeTab.id);
        if (!imageObj) { //indicator if has errors then draw indicator on button
            if (!tabState.hasErrors()) {
                button.icon = elogioIcon;
                button.label = _('pluginStateOn');
            } else {
                button.icon = errorIndicator;
                button.label = _('pluginGlobalError');
            }
        }
        if (imageObj && imageObj.error && !imageObj.noData) {
            tabState.putImageToStorage(imageObj);
            button.icon = errorIndicator;
            button.label = _('pluginGlobalError');
        }
        if (imageObj && imageObj.error && !sidebarIsHidden) {
            bridge.emit(bridge.events.newImageFound, imageObj);
        }
    }


    function loadApplicationPreferences() {
        var tabsState = appState.getAllTabState(), i, tabContentWorker;
        config.ui.imageDecorator.iconUrl = self.data.url('img/settings-icon.png');
        config.ui.highlightRecognizedImages = simplePrefs.prefs.highlightRecognizedImages;
        if (simplePrefs.prefs.serverUrl) {
            config.global.apiServer.serverUrl = simplePrefs.prefs.serverUrl;
        }
        config.global.locator.deepScan = simplePrefs.prefs.deepScan;
        bridge.emit(bridge.events.configUpdated, config);
        for (i = 0; i < tabsState.length; i += 1) {
            tabContentWorker = tabsState[i].getWorker();
            if (tabContentWorker && tabContentWorker.port) {
                tabContentWorker.port.emit(bridge.events.configUpdated, config);
            }
        }
    }

    function setupLocale(bridge) {
        var locale = {
            feedbackLabel: _('feedbackLabel'),
            dropDownMenuLabel: _('dropDownMenuLabel'),
            copyHtmlButtonLabel: _('copyHtmlButtonLabel'),
            copyJsonButtonLabel: _('copyJsonButtonLabel'),
            copyImgButtonLabel: _('copyImgButtonLabel'),
            sourceButtonLabel: _('sourceButtonLabel'),
            licenseButtonLabel: _('licenseButtonLabel'),
            reportButtonLabel: _('reportButtonLabel'),
            queryButtonLabel: _('queryButtonLabel'),
            openImgInNewTabLabel: _('openImageInNewTabLabel'),
            noLookup: _('noLookup')
        };
        bridge.emit(bridge.events.l10nSetupLocale, locale);
    }

    function contextMenuItemClicked(uuid) {
        if (currentTab === tabs.activeTab) {
            if (sidebarIsHidden) {
                // at first we set 'scrollToImageCard', which needs for send to panel when panel will shows up
                scrollToImageCard = uuid;
                elogioSidebar.show();
            } else {
                // if panel already open then just send image to it
                if (uuid) {
                    bridge.emit(bridge.events.onImageAction, uuid);
                }
            }
        }
    }

    /**
     * CONTEXT MENU
     */
    contextMenu.Item({
        label: _('contextMenuItem_01'),
        context: [contextMenu.SelectorContext('*')],
        contentScriptFile: [ self.data.url("js/context-menu.js")],
        onMessage: contextMenuItemClicked
    });


    /**
     * CREATE SIDEBAR
     */
    elogioSidebar = Sidebar({
        id: 'elogio-firefox-plugin',
        title: _('sidebarTitle'),
        url: self.data.url("html/panel.html"),
        onReady: function (worker) {
            pluginState.isEnabled = true;
            bridge.registerClient(worker.port);
            sidebarIsHidden = false;
            // Update config with settings from the Preferences module
            loadApplicationPreferences();
            //after registration and loading preferences we need to register all listeners of sidebar
            registerSidebarEventListeners(bridge);
            // ... and subscribe for upcoming changes
            simplePrefs.on('', loadApplicationPreferences);
            notifyPluginState(bridge);
            // Load content in sidebar if possible
            if (pluginState.isEnabled) {
                setupLocale(bridge);
                var tabState = appState.getTabState(tabs.activeTab.id),
                    images = tabState.getImagesFromStorage();
                if (images.length) {
                    //if need scroll to element then we do it
                    if (scrollToImageCard) {
                        bridge.emit(bridge.events.tabSwitched, {images: images, imageCardToOpen: scrollToImageCard});
                        scrollToImageCard = null;
                    } else {
                        bridge.emit(bridge.events.tabSwitched, {images: images});
                    }
                } else {
                    //if storage doesn't contains any image
                    bridge.emit(bridge.events.startPageProcessing);
                }
            }
        },
        onDetach: function () {
            button.icon = elogioDisableIcon;
            sidebarIsHidden = true;
        }
    });
    /**
     * PAGE ON ATTACH
     */
    pageMod.PageMod({
        include: "*",
        contentStyleFile: [self.data.url("css/highlight.css"), self.data.url("css/contextMenu.css")],
        contentScriptFile: [self.data.url("js/common-lib.js"), self.data.url("js/content-script.js")],
        contentScriptWhen: "ready",
        attachTo: 'top',
        onAttach: function (contentWorker) {
            currentTab = contentWorker.tab;
            var
                tabState = appState.getTabState(currentTab.id);
            tabState.clearImageStorage();
            tabState.clearLookupImageStorage();
            tabState.attachWorker(contentWorker);
            //if page from cache then we need to save it to tabState
            currentTab.on("pageshow", function (tab, isPersisted) {
                var tabState = appState.getTabState(tab.id);
                if (isPersisted) {
                    tabState.isPageHidden(true);
                } else {
                    tabState.isPageHidden(false);
                }
            });
            contentWorker.port.on(bridge.events.pageProcessingFinished, function () {
                // if page processing finished then we need to check if all lookup objects were sent to Elog.io server
                if (tabState.getImagesFromLookupStorage().length > 0) {
                    lookupQuery(tabState.getImagesFromLookupStorage(), contentWorker);
                    appState.getTabState(contentWorker.tab.id).clearLookupImageStorage();
                }
            });
            //when hash calculated then send hash lookup request
            contentWorker.port.on(bridge.events.hashCalculated, function (imageObj) {
                var imageObjFromStorage = tabState
                    .findImageInStorageByUuid(imageObj.uuid);
                if (!imageObj.error) {
                    imageObjFromStorage.hash = imageObj.hash;
                    console.log('hash is: ' + imageObj.hash + '  and src= ' + imageObj.uri);
                    elogioServer.hashLookupQuery({hash: imageObjFromStorage.hash, src: imageObjFromStorage.uri, context: imageObj.domain}, function (json) {
                        if (Array.isArray(json) && json.length > 0) {
                            imageObjFromStorage.lookup = utils.getJSONByLowestDistance(json);
                            delete imageObjFromStorage.error;
                            delete imageObjFromStorage.noData;
                            bridge.emit(bridge.events.newImageFound, imageObjFromStorage);//send message when lookup received
                            contentWorker.port.emit(bridge.events.newImageFound, imageObjFromStorage);//and content script too (for decorate)
                            //it means, what we need details, because user click on 'query to elog.io'
                            bridge.emit(bridge.events.imageDetailsRequired, imageObjFromStorage);
                        } else {
                            //if we get an empty array, that's mean what no data for this image
                            imageObjFromStorage.error = _('noDataForImage');
                            imageObjFromStorage.noData = true;
                            indicateError(imageObjFromStorage);
                        }
                    }, function (response) {
                        console.log('text status ' + response.statusText + ' ; status code ' + response.status);
                        imageObjFromStorage.error = getTextStatusByStatusCode(response.status);
                        indicateError(imageObjFromStorage);
                    });
                } else {
                    //if we get error when using blockhash
                    console.log('hash is: ' + imageObj.error + '  and src= ' + imageObj.uri);
                    imageObjFromStorage.error = _('blockhashError');
                    imageObjFromStorage.blockhashError = 'yes';//we need to mark if block hash error
                    indicateError(imageObjFromStorage);
                }
            });

            // if some image was removed from DOM then we need to delete it at here too and send to panel onImageRemoved
            contentWorker.port.on(bridge.events.onImageRemoved, function (uuid) {
                var tabState = appState.getTabState(currentTab.id);
                bridge.emit(bridge.events.onImageRemoved, uuid);
                tabState.removeImageFromStorageByUuid(uuid);
            });

            contentWorker.port.on(bridge.events.newImageFound, function (imageObject) {
                var tabState = appState.getTabState(currentTab.id);
                // Maybe we already have image with this URL in storage?
                if (tabState.findImageInStorageByUrl(imageObject.uri)) {
                    return;
                }
                tabState.putImageToStorage(imageObject);
                if (currentTab === tabs.activeTab) {
                    // if image was found then we need to check if lookup storage is ready for query
                    if (tabState.getImagesFromLookupStorage().length >= config.global.apiServer.imagesPerRequest) {
                        lookupQuery(tabState.getImagesFromLookupStorage(), contentWorker);
                        tabState.clearLookupImageStorage();
                    }
                    tabState.putImageToLookupStorage(imageObject);
                    bridge.emit(bridge.events.newImageFound, imageObject);
                }
            });
            //if event from content received and current page is from cache then we need to undecorate all images and start page processing from scratch
            contentWorker.port.on(bridge.events.pageShowEvent, function () {
                var tabState = appState.getTabState(currentTab.id);
                if (tabState.isPageHidden()) {
                    tabState.attachWorker(contentWorker);//reattach worker
                    this.emit(bridge.events.pageShowEvent);//undecorate all images on the page
                    if (!sidebarIsHidden) {
                        bridge.emit(bridge.events.startPageProcessing);//start page processing from scratch
                    } else {
                        //if tab is hidden then we need send emit to content by self
                        tabState.clearImageStorage();
                        tabState.clearLookupImageStorage();
                        this.emit(bridge.events.startPageProcessing);
                    }
                }
            });
            // When user click on the elogio icon near the image
            contentWorker.port.on(bridge.events.onImageAction, contextMenuItemClicked);
            //this code we need to do only if plugin is active
            if (pluginState.isEnabled) {
                contentWorker.port.emit(bridge.events.configUpdated, config);
                //when content script attached to page we need to start scan the page
                bridge.emit(bridge.events.startPageProcessing);
            }
        }
    });

    tabs.on('close', function (tab) {
        appState.dropTabState(tab.id);
    });
    tabs.on('activate', function (tab) {
        if (pluginState.isEnabled) {
            var tabState = appState.getTabState(tab.id);
            var images = tabState.getImagesFromStorage();
            indicateError();//if we call without params then method just indicate: tab has errors or return initial state to button
            bridge.emit(bridge.events.tabSwitched, {images: images});
        }
    });
    // Create UI Button
    var button = buttons.ActionButton({
        id: "elogio-button",
        label: _('pluginStateOn'),
        icon: elogioDisableIcon,
        onClick: function () {
            toggleSidebar();
        }
    });
});
