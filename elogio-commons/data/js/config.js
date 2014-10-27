/**
 * Created by LOGICIFY\corvis on 9/15/14.
 */

Elogio.modules.config = function (modules) {
    'use strict';
    this.global = {
        apiServer: {
            serverUrl: 'https://catalog.elog.io',
            lookupContext: '/lookup/uri',
            hashLookupContext: '/lookup/blockhash',
            imagesPerRequest: 10,
            gravatarServerUrl: 'http://www.gravatar.com/avatar/',
            urlLookupOptions: {include: ['owner'], annotations: ['title,locator,policy,creator,copyright']}
        },
        locator: {
            limitImageHeight: 100,
            limitImageWidth: 100,
            deepScan: true
        }
    };


    this.ui = {
        imageDecorator: {
            iconUrl: '',
            iconWidth: 20,
            iconHeight: 20
        },
        highlightRecognizedImages: false,
        dataAttributeName: 'elogio',
        elogioFounded: 'elogiofounded',
        decoratedItemAttribute: 'elogiodecorated',
        panelAttribute: 'elogiopanelimage'
    };
    this.sidebar = {
        imageObject: 'imageObj'
    };
    this.errors = {
        requestError: 'Server responded, but with errors',
        noDataForImage: 'Sorry, we couldn\'t match this against any image in the Elog.io catalog',
        blockhashError: "The image could not be matched (most likely the web site you\'re viewing has security restrictions that prevent us from reading the image. You can open this image in new tab and try query again."
    };
    this.logging = {

    };
};
