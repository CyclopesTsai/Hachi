#!/bin/sh
# Throwaway mTLS test certificates (decision 147). Run in this folder with OpenSSL 3.
set -e
for ca in ca other-ca; do
  openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj "/CN=Hachi Test $ca" \
    -keyout $ca-key.pem -out $ca.pem \
    -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign
done
sign() { # name, CA, extensions
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$1" -keyout $1-key.pem -out $1.csr
  printf "$3" > $1.ext
  openssl x509 -req -in $1.csr -CA $2.pem -CAkey $2-key.pem -set_serial 0x$(openssl rand -hex 8) \
    -days 36500 -extfile $1.ext -out $1.pem
  rm $1.csr $1.ext
}
sign server ca 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n'
sign client ca 'extendedKeyUsage=clientAuth\n'
sign stranger other-ca 'extendedKeyUsage=clientAuth\n'
openssl rsa -in client-key.pem -aes256 -passout pass:secret -out client-key-encrypted.pem
openssl pkcs12 -export -in client.pem -inkey client-key.pem -passout pass:secret -out client.p12
openssl pkcs12 -export -legacy -in client.pem -inkey client-key.pem -passout pass:secret \
  -out client-legacy.p12
rm ca-key.pem other-ca-key.pem
