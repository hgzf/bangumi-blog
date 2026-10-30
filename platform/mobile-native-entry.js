import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  Directory,
  Encoding,
  Filesystem
} from "@capacitor/filesystem";

globalThis.PlatformMobileNative = {
  Capacitor,
  CapacitorHttp,
  Directory,
  Encoding,
  Filesystem
};
