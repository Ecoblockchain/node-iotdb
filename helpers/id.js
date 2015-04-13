/*
 *  id.js
 *
 *  David Janes
 *  IOTDB.org
 *  2014-02-03
 *
 *  Things related to identifiers
 *
 *  Copyright [2013-2015] [David P. Janes]
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

"use strict";

var crypto = require('crypto');
var path = require('path');
var url = require('url');

var canonical_json = require('canonical-json')
var _ = require("../helpers");


var _safe = function(component) {
    return encodeURIComponent(component).replace('%', '$');
}

/**
 *  Unique thing
 */
var _thing_urn_unique = function() {
    var parts = [ "urn", "iotdb", "thing" ];
    for (var ai in arguments) {
        parts.push(_safe(arguments[ai]));
    }

    return parts.join(":");
};

/**
 *  Unique thing, but hashing required of last com
 */
var _thing_urn_unique_hash = function() {
    var parts = [ "urn", "iotdb", "thing" ];
    for (var ai = 0; ai < arguments.length - 1; ai++) {
        parts.push(_safe(arguments[ai]));
    }

    var hasher = crypto.createHash('md5');
    hasher.update(arguments[arguments.length - 1]);
    parts.push(hasher.digest("hex"));

    return parts.join(":");
};

/**
 *  Unique on this network
 */
var _thing_urn_network = function() {
    var hasher = crypto.createHash('md5');
    hasher.update("some-network-id");

    var parts = [ "urn", "iotdb", "thing" ];
    for (var ai in arguments) {
        parts.push(_safe(arguments[ai]));
        hasher.update("" + arguments[ai]);
    }

    parts.push(hasher.digest("hex"));

    return parts.join(":");
};

/**
 *  Unique on this machine
 */
var _thing_urn_machine = function() {
    var hasher = crypto.createHash('md5');
    hasher.update("some-machine-id");

    var parts = [ "urn", "iotdb", "thing" ];
    for (var ai in arguments) {
        parts.push(_safe(arguments[ai]));
        hasher.update("" + arguments[ai]);
    }

    parts.push(hasher.digest("hex"));

    return parts.join(":");
};

/**
 *  Make a canonical ID for a Model
 */
var model_urn = function(jsonld) {
    var src_jsonld = _.deepCopy(jsonld);

    var base_url = src_jsonld["@context"]["@base"];
    var base_name = path.basename(url.parse(base_url).path).replace(/^.*:/, '')

    src_jsonld["@context"]["@base"] = "";
    src_jsonld["@context"]["@vocab"] = "";

    src_jsonld = _.ld.compact(src_jsonld);

    var canonical_jsonld = canonical_json(jsonld)

    var canonical_hash = _.hash.md5(canonical_jsonld);
    var model_urn = "urn:iotdb:model:" + canonical_hash + ":" + base_name;

    return model_urn;
};

/**
 *  Make a canonical ID for a User.
 *  A user is simply identified by a URL.
 *  We do some _minor_ canonicalization,
 *  mainly to the hostname
 */
var user_urn = function(user_url) {
    var user_url = url.format(url.parse(user_url))
    var user_hash = _.hash.md5(user_url);

    return "urn:iotdb:user:" + user_hash;
};

exports.id = {
    model_urn: model_urn,
    user_urn: user_urn,
    thing_urn: {
        unique: _thing_urn_unique,
        unique_hash: _thing_urn_unique_hash,
        network_unique: _thing_urn_network,
        machine_unique: _thing_urn_machine,
    },
};
